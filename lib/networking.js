var debug = require('debug')('mdns:lib:networking');

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var os = require('os');
var dgram = require('dgram');
var semver = require('semver');

var dns = require('mdns-js-packet');
var DNSPacket = dns.DNSPacket;

var MDNS_PORT = 5353;
var MDNS_MULTICAST_IPV4 = '224.0.0.251';
var INADDR_ANY_NAME = '`ANY`';
var INADDR_ANY_IPV4 = '0.0.0.0';

var Networking = module.exports = function (options) {
  debug('new Networking instance');
  this.options = options || {};
  this.created = 0;
  this.connections = [];
  this.started = false;
  this.multicast;
  this.supportsReuseAddr = semver.gte(process.versions.node, '0.11.13');
  this.INADDR_ANY = true;
  this.starting = false;
};

util.inherits(Networking, EventEmitter);


Networking.prototype.start = function () {

  if (this.starting) {
    console.trace('this is no good');
    return ;
  }
  debug('start');
  this.starting = true;
  var interfaces = os.networkInterfaces();
  var ifaceFilter = this.options.networkInterface;
  var index = 0;
  this.started = true;
  // apple-tv always replies back using multicast,
  // regardless of the source of the query, it is answering back.
  // if (this.INADDR_ANY) {
  //   this.createSocket(index++, INADDR_ANY_NAME,
  //     INADDR_ANY_IPV4, MDNS_PORT, this.bindToAddress.bind(this));
  // }
  // else {
    for (var key in interfaces) {
      if ((interfaces.hasOwnProperty(key)) &&
            ((typeof ifaceFilter === 'undefined') || (key === ifaceFilter))) {
        for (var i = 0; i < interfaces[key].length; i++) {
          var iface = interfaces[key][i];
          //no localhost
          if (iface.internal) {
            continue;
          }
          //no IPv6 addresses
          if (iface.address.indexOf(':') !== -1) {
            continue;
          }
          debug('interface', key, iface.address);
          this.createSocket(index++, key,
            iface.address, 0, this.bindToAddress.bind(this));
        }
      }
    }

  // }
};


Networking.prototype.stop = function () {
  debug('stopping');

  this.connections.forEach(closeEach);
  this.connections = [];

  function closeEach(connection) {
    var socket = connection.socket;
    socket.close();
    socket.unref();
  }
  this.starting = false;
};


Networking.prototype.createSocket = function (
  interfaceIndex, networkInterface, address, port, next) {
  var sock;
  if (this.supportsReuseAddr) {
    sock = dgram.createSocket({type:'udp4', reuseAddr:true});
  }
  else {
    sock = dgram.createSocket('udp4');
  }
  sock.on('error', function (err) {
    next(err, interfaceIndex, networkInterface, sock);
  });
  debug('creating socket for', networkInterface);
  this.created++;
  var multicast = false;

  sock.bind(port, address, function (err) {
    if ((!err) && (port === MDNS_PORT)) {
      sock.addMembership(MDNS_MULTICAST_IPV4);
      sock.setMulticastTTL(255);
      sock.setMulticastLoopback(true);
      multicast = true;
    }
    next(err, interfaceIndex, networkInterface, sock, multicast);
  });
};


Networking.prototype.bindToAddress = function (err, interfaceIndex, networkInterface, sock, multicast) {
  if (err) {
    debug('there was an error binding %s', err);
    return;
  }
  debug('bindToAddress', networkInterface);
  var info = sock.address();

  var connection = {
    socket:sock,
    interfaceIndex: interfaceIndex,
    networkInterface: networkInterface,
    multicast: multicast,
    counters: {
      sent: 0,
      received: 0,
      sentErrors: 0,
      receivedErrors: 0
    }
  };

  this.connections.push(connection);

  var self = this;

  sock.on('message', function (message, remote) {
    var packets;
    debug({message: message.toString('hex'), direction: 'inbound', src: remote.address}, 'inbound message');
    try {
      packets = dns.DNSPacket.parse(message);
      if (!(packets instanceof Array)) {
        packets = [packets];
      }
      connection.counters.received++;
    }
    catch (er) {
      //partial, skip it
      connection.counters.receivedErrors++;
      debug('packet parsing error', er);
    }
    if(packets) {
      self.emit('packets', packets, remote, connection);
    }

    //self.emit('packets', packets, remote, connection);
  });

  sock.on('error', self.onError.bind(self));

  sock.on('close', function () {
    debug('socket closed', info);
  });


  if (this.created === this.connections.length) {
    debug('networking ready');
    this.emit('ready', this.connections.length);
  }
};//--bindToAddress


Networking.prototype.onError = function (err) {
  this.emit('error', err);
};


Networking.prototype.send = function (packet, options) {
  var self = this;
  var buf = DNSPacket.toBuffer(packet);
  options = options || {};
  if(typeof options.multicast === 'undefined') {
    options.multicast = true;
  }

  if(typeof options.unicast === 'undefined') {
    options.unicast = true;
  }
  var address = options.address || MDNS_MULTICAST_IPV4;
  debug({message: buf.toString('hex'), direction: 'outbound', dst: address}, 'message');
  this.connections.forEach(onEach);
  //debug('created buffer with length', buf.length);

  function onEach(connection) {
    // if(connection.multicast && !options.multicast) {
    //   debug('not sending on interface', connection.multicast, options.multicast);
    //   return;
    // }
    // if(!connection.multicast && !options.unicast) {
    //   debug('not sending on interface', connection.multicast, options.multicast);
    //   return;
    // }
    var sock = connection.socket;
    // if the user did not specially asked for the pseudo interface
    // skip sending message on that interface.
    if (sock.address().address === INADDR_ANY_IPV4 && !self.INADDR_ANY) {
      debug('skip send on pseudo interface.', sock.address().address, this.INADDR_ANY);
    }
    else {

      debug('sending to %s on interface %s', address, sock.address().address);

      sock.send(buf, 0, buf.length, MDNS_PORT, address, function (err, bytes) {
        if (err) {
          connection.counters.sentErrors++;
        }
        else {
          connection.counters.sent++;
        }
        debug('%s sent %d bytes with err:%s', sock.address().address, bytes, err);
      });
    }
  }
};

Networking.prototype.startRequest = function (callback) {
  if (this.started) {
    if (typeof callback === 'function') {
      return process.nextTick(callback);
    }
    else {
      return;
    }
  }
  this.start();
  this.once('ready', function () {
    if (typeof callback === 'function') {
      callback();
    }
  });
};


Networking.prototype.stopRequest = function () {
  //if (this.users.length === 0) {
    this.stop();
  //}
};

