var debug = require('debug')('mdns:lib:daemon');

var util = require('util');
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');

var Datastore = require('nedb');

var dns = require('mdns-js-packet');
var DNSRecord = dns.DNSRecord;
var DNSPacket = dns.DNSPacket;
var ServiceType = require('./service_type').ServiceType;
var pf = require('./packetfactory');
var packetIndex = 1;

var REVERSE_LOOKUP = '.in-addr.arpa';

function getId() {
  if (packetIndex > 65535) {
    packetIndex = 1;
  }
  return packetIndex++;
}

function getAddrFromReverse(name) {
  return name.substr(0, name.indexOf(REVERSE_LOOKUP))
        .split('.').reverse().join('.');
}

function writeJson(filename, obj) {
  fs.writeFile(filename, JSON.stringify(obj, null, 4), function (err) {
    if (err) {
      debug(err);
    }
  });
}


var internal = {};

internal.discover = function (serviceType) {
    var packet = new DNSPacket();
    //packet.id = getId();
    debug('discover', serviceType);
    packet.question.push(new DNSRecord(
      serviceType.toString() + '.local',
      DNSRecord.Type.PTR, 1)
    );

    this.networking.send(packet, {unicast: false});
};



internal.packetHandler = function (packets, remote /*, connection*/) {
  if (remote.address === '192.168.1.101') {
    return ;
  }
  var self = this;
  // self.emit('packets', packets, remote, connection);
  debug('got %s packet(s) from %s', packets.length, remote.address);
  if (!packets) {
    debug('strange, no packets', arguments);
    return;
  }
  packets.forEach(function (packet) {
    debug('packet got %d questions, %d answers, %d authority and %d additional',
      packet.question.length,
      packet.answer.length,
      packet.authority.length,
      packet.additional.length);

    packet.question.forEach(handle(internal.handleQuery));
    packet.answer.forEach(handle(internal.handleAnswer));
    packet.additional.forEach(handle(internal.handleAdditional));
    //debug('packet got %s authority', packet.authority.length);
    if (packet.header.id > 0) {
      internal.handleResponse.call(self, packet, remote);
    }

  });

  function handle(fn) {
    return function (rec) {
      fn.call(self, rec, remote);
    };
  }
};

internal.handleResponse = function (packet, remote) {
  var id = packet.header.id;
  if (this.requestQueue.hasOwnProperty(id)) {
    var req = this.requestQueue[id];
    clearTimeout(req.timeout);
    delete this.requestQueue[id];
    this.removeUsage(req);
    req.callback(null, {packet: packet, remote: remote});
  }
  else {
    debug('no request with id %s', id, this.requestQueue);
  }
};


internal.handleAdditional = function (rec, remote) {
  debug('handleAdditional Type:%s, Class:%s -> %j', rec.typeName, rec.className, rec);
  internal.handleAnswer.call(this, rec, remote);
};

internal.handleQuery = function (rec, remote) {
  debug('handleQuery "%s" type=%s, class=%s', rec.name, rec.typeName, rec.className);
  if (rec.type !== DNSRecord.Type.PTR &&
    rec.type !== DNSRecord.Type.SRV &&
    rec.type !== DNSRecord.Type.ANY &&
    rec.type !== DNSRecord.Type.TXT) {
    debug('skipping query: type not PTR/SRV/ANY');
    return;
  }
  var self = this;

  // check if we should reply via multi or unicast
  // TODO: handle the is_qu === true case and reply directly to remote
  var is_qu = (rec.cl & DNSRecord.Class.IS_QM) === DNSRecord.Class.IS_QM;
  rec.class &= ~DNSRecord.Class.IS_QM;
  if (!(rec.class === DNSRecord.Class.IN || rec.type === DNSRecord.Class.ANY)) {
    debug('skipping query: class not IN/ANY: %s', rec.className, rec);
    return;
  }
  try {
    var p = rec.name.indexOf(REVERSE_LOOKUP);
    if (p >= 6) {
      var address = getAddrFromReverse(rec.name);
      debug('someone is doing a reverse lookup for %s', address);
    }
    else {
      var type = new ServiceType(rec.name);
      self.services.forEach(function (service) {
        if (type.isWildcard() || type.matches(service.serviceType)) {
          debug('answering query');
          // TODO: should we only send PTR records if the query was for PTR
          // records?
          self.send(
            pf.buildANPacket.apply(service, [DNSRecord.TTL]));
        }
        else {
          debug('skipping query; type %s not * or %s', type,
              service.serviceType);
        }
      });
    }
  }
  catch (err) {
    debug('error in handleQuery', err);
    // invalid service type
  }
};


internal.handleAnswer = function (rec, remote) {
  var self = this;
  //debug('answer "%s" type=%s, class=%s', rec.name, rec.typeName, rec.className);
  //this.handleProbe(rec);
  switch (rec.type) {
    case DNSRecord.Type.PTR:
      internal.answerPTR.call(self, rec, remote);
      break;
    case DNSRecord.Type.TXT:
      internal.answerTXT.call(self, rec, remote);
      break;
    case DNSRecord.Type.A:
      var update = {$set: {fullname: rec.name}};
      internal.upsertHostService.call(self, rec.address, update);
      break;
    case DNSRecord.Type.AAAA:
      var update = {$set: {fullname: rec.name}};
      internal.upsertHostService.call(self, rec.address, update);
      break;
    case DNSRecord.Type.SRV:
      internal.answerSRV.call(self, rec, remote);
      break;
    default:
      debug('can\'t handle answer of type %s', rec.typeName);
      debug('rec', rec);
  }
};

internal.answerSRV = function (rec, remote) {
  try {
    var s = new ServiceType(rec.name);
    var data = {};
    data[s.toString() + '.port'] = rec.port;
    data[s.toString() + '.weight'] = rec.weight;
    data[s.toString() + '.priority'] = rec.priority;
    internal.upsertHostService.call(this, remote.address, {$set: data});
  }
  catch (err) {
    debug('error in answerSRV');
  }
}

internal.answerTXT = function (rec, remote) {
  try {
    var s = new ServiceType(rec.name);
    var key = s.toString();
    var data = {};
    rec.data.forEach(function (row) {
      var kv = row.split('=');
      data[key + '.' + kv[0]] = kv[1];
    });
    data[key + '.hostname'] = s.descriptor;
    var update = {$set: data};
    internal.upsertHostService.bind(this)(remote.address, update);
    //debug('txt', s);
  }
  catch(err) {
    debug('error in answerTXT', err);
  }
};


internal.answerPTR = function (rec, remote) {
  // if (packet.header.qr === 1 && rec.name.indexOf('_service') === 0) {
  //   if (rec.data) {
  //     obj.type.push(new ServiceType(rec.data.replace('.local', '')));
  //   }
  //   else {
  //     processed--;
  //   }
  // }
  // else

  try {
    if (rec.name.indexOf('_') === 0) {
      //probably a service of some kind
      var s = new ServiceType(rec.name.replace('.local', ''));

      if (s.isWildcard()) {
        //data contains actual service
        s = new ServiceType(rec.data.replace('.local', ''));
      }
      //debug('service from %s', remote.address, st);
      internal.serviceUp.call(this, remote.address, s, s.descriptor);
    }
    else if(rec.name.indexOf(REVERSE_LOOKUP) >= 0) {
      var address = getAddrFromReverse(rec.name);

      internal.upsertHostService.call(this, address, {
        $set: {fullname: rec.data}
      });
    }
    else {
      debug('unhandled record in answerPTR', rec);
    }
  }
  catch(err) {
    debug('error in answerPTR', err, rec, err.stack);
  }
};

internal.serviceUp = function (address, service, hostname) {
  var serviceName = service.toString();
  var update = {
    $addToSet: {services: serviceName},
  };
  if (hostname) {
    update.$set = {hostname: s.descriptor};
  }
  internal.upsertHostService.call(this, address, update);
  var obj = {service: service, address: address};
  this.browsers.forEach(function (b) {
    if (b.serviceType.toString() === serviceName || b.serviceType.isWildcard()) {
      if (typeof b.onServiceUp === 'function') {
        process.nextTick(function () {
          b.onServiceUp(obj);
        });
      }
    }
  });
};


/**
 * Upsert the host service database
 */
internal.upsertHostService = function (address, update) {
  this.changed = true;
  try {
    var query = {address: address};

    //debug('upsertHostService', query, update);
    this.db.update(query, update, {upsert: true}, function (err, numRep) {
      if (err) {
        return debug('err.upsertHostService', err, query, update);
      }
      //debug('upsertHostService', numRep, query, update);
    });
  }
  catch (err) {
    debug('error in upsertHostService', err);
  }
};


var Daemon = module.exports = function (networking) {
  if (typeof networking !== 'object') {
    throw new TypeError('Must be instance of Networking');
  }
  debug('new daemon instance');
  this.changed = false;
  this.networking = networking;
  this.uses = [];
  this.db = new Datastore();

  // Array of pending probes.
  this.probes = [];
  // Array of published services.
  this.services = [];

  // Array of listening browsers
  this.browsers = [];
  this.requestQueue = {};

  networking.on('packets', internal.packetHandler.bind(this));
};

util.inherits(Daemon, EventEmitter);

Daemon.prototype.start = function (next) {
  debug('starting');
  this.networking.startRequest(next);
};

Daemon.prototype.stop = function () {
  debug('stopping');
  clearInterval(this.dumpTimer);
  this.dumpDb(function (err, docs) {
    writeJson('db.json', docs);
  });
  this.networking.stopRequest();
};

Daemon.prototype.dumpDb = function (callback) {
  this.db.find({}).sort({address: 1}).exec(callback);
};

Daemon.prototype.send = function () {
  this.networking.send.apply(this.networking, arguments);
};

Daemon.prototype.addUsage = function (instance, next) {
  this.uses.push(instance);
  this.networking.startRequest(next);
  if (!this.dumpTimer) {
    this.dumpTimer = setInterval(function () {
      if (this.changed) {
        this.dumpDb(function (err, docs) {
          writeJson('db.json', docs);
        });
        this.changed = false;
      }
    }.bind(this), 5000);
  }
};


Daemon.prototype.removeUsage = function (instance) {
  var index = this.uses.indexOf(instance);
  if (index > -1) {
    this.uses.splice(index, 1);
  }
  if (this.uses.length === 0) {
    this.networking.stopRequest();
    clearInterval(this.dumpTimer);
  }
};


Daemon.prototype.addBrowser = function (browser, callback) {
  var self = this;
  this.browsers.push(browser);
  this.addUsage(browser, function () {
    internal.discover.call(this, browser.serviceType);
    if (typeof callback === 'function')  {
      callback();
    }
  });
}

Daemon.prototype.addProbe = function (probe, callback) {
  var self = this;
  this.probes.push(probe);
  this.addUsage(probe, function () {
    setTimeout(function () {
      self.probeAndAdvertise(probe);
    }, 250);
    callback();
  });
};


Daemon.prototype.removeProbe = function (probe) {
  debug('unpublishing service');
  this.services =
    this.services.filter(function (service) { return service !== probe; });

  this.send(pf.buildANPacket.apply(probe, [0]));
  probe.nameSuffix = '';
  probe.alias = '';
  probe.status = 0; // inactive
  this.removeUsage(probe);
};


Daemon.prototype.probeAndAdvertise = function (probe) {
  debug('probeAndAdvertise(%s)', probe.status);
  var self = this;
  switch (probe.status) {
    case 0:
    case 1:
    case 2:
      self.send(pf.buildQDPacket.apply(probe, []));
      break;
    case 3:
      debug('publishing service "%s", suffix=%s', probe.alias, probe.nameSuffix);
      var packet = pf.buildANPacket.apply(probe, [DNSRecord.TTL]);
      self.send(packet);
      // Repost announcement after 1sec (see rfc6762: 8.3)
      setTimeout(function onTimeout() {
        self.send(packet);
      }, 1000);

      // Service has been registered, respond to matching queries
      self.services.push(probe);

      // //remove probe from list once it's been registered
      // self.probes =
      //   self.probes.filter(function (service) { return service === probe; });

      break;
    case 4:
      // we had a conflict
      if (probe.nameSuffix === '') {
        probe.nameSuffix = '1';
      }
      else {
        probe.nameSuffix = (parseInt(probe.nameSuffix) + 1) + '';
      }
      probe.status = -1;
      break;
  }

  if (probe.status < 3) {
    probe.status++;
    setTimeout(function () {
      self.probeAndAdvertise(probe);
    }, 250);
  }
};//--probeAndAdvertise




Daemon.prototype.handleProbe = function (rec) {
  var self = this;
  try {
    self.probes.forEach(function (service) {
      if (service.status < 3) {
        var conflict = false;
        // parse answers and check if they match a probe
        debug('check names: %s and %s', rec.name, service.alias);
        switch (rec.type) {
          case DNSRecord.Type.PTR:
            if (rec.asName() === service.alias) {
              conflict = true;
              debug('name conflict in PTR');
            }
            break;
          case DNSRecord.Type.SRV:
          case DNSRecord.Type.TXT:
            if (rec.name === service.alias) {
              conflict = true;
              debug('name conflict in SRV/TXT');
            }
            break;
        }
        if (conflict) {
          // no more probes
          service.status = 4;
        }
      }
    });
  }
  catch (err) {
    // invalid service type
  }
};

Daemon.prototype.sendRequest = function (packet, dstAddress, callback) {
  if (typeof dstAddress === 'function') {
    callback = dstAddress;
    dstAddress = undefined;
  }
  if (typeof callback !== 'function') {
    callback = function () {};
  }
  var id = getId();
  packet.header.id = id;
  var req = {
    packet: packet,
    dstAddress: dstAddress,
    callback: callback
  };

  req.timeout = setTimeout(function () {
    delete this.requestQueue[id];
    req.callback(new Error('timeout'), null);
    this.removeUsage(req);
  }.bind(this), 2000);

  this.requestQueue[id] = req;
  this.addUsage(req, function () {
    this.networking.send(packet, {unicast: false});
  });
};

Daemon.prototype.resolveAddress = function (name) {

};

Daemon.prototype.resolveName = function (address, callback) {
  debug('resolveName', address);
  var packet = new DNSPacket();
  packet.rd = 1;

  packet.question.push(new DNSRecord(
    address.split('.').reverse().join('.') + '.in-addr.arpa.',
    DNSRecord.Type.PTR, 1)
  );
  this.sendRequest(packet, function (err, result) {
    debug('response from resolveName, err:%s', err);
    if (callback === 'function') {
      callback(null, result);
    }
  });
};

Daemon.prototype.serviceDetails = function (serviceType, address, callback) {
  if (typeof serviceType === 'string') {
    serviceType = new ServiceType(serviceType);
  }
  if (serviceType.isWildcard()) {
    throw new Error('need to be a a specific type');
  }

  var packet = new DNSPacket();
  packet.header.rd = 0;
  packet.question.push(new DNSRecord(
      serviceType.toString() + '.local',
      DNSRecord.Type.PTR,
      DNSRecord.Class.IN));
  this.sendRequest(packet, address, function (err, result) {
    if (typeof callback === 'function') {
      var projection = {fullname: 1};
      var key = '_' + serviceType.name;
      projection[key] = 1

      this.db.findOne({address: address}, projection, function (err, doc) {
        result.service = doc[key];
        result.fullname = doc.fullname;
        callback(null, {
          service: doc[key],
          fullname: doc.fullname,
          address: result.remote.address
        });
      });
    }

  }.bind(this));
};
