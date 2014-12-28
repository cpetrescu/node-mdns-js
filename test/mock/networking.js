
var debug = require('debug')('mdns:test:mock:networking');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

var DNSPacket = require('mdns-js-packet').DNSPacket;

var Networking = module.exports = function () {

}

util.inherits(Networking, EventEmitter);


Networking.prototype.startRequest = function (callback) {
  process.nextTick(callback);
}


Networking.prototype.send = function (packet, options) {
  options = options || {};
  if(typeof options.multicast === 'undefined') {
    options.multicast = true;
  }

  if(typeof options.unicast === 'undefined') {
    options.unicast = true;
  }
  this.emit('mockSend', packet, options);
}

Networking.prototype.inject = function (payload, remote, connection) {

  var packets;
  if (payload instanceof Buffer) {
    packets = DNSPacket.parse(payload);
  }
  else if (payload instanceof DNSPacket) {
    packets = payload;
  }
  else {
    throw new TypeError('DNSPacket or Buffer')
  }

  if (!(packets instanceof Array)) {
    packets = [packets];
  }

  remote = remote || {address: '172.16.1.42', port:5353};
  connection = connection || {
    interfaceIndex: 0,
    networkInterface: 'eth0',
    multicast: false
  };

  debug('inject emit "packets"')
  this.emit('packets', packets, remote, connection)
}