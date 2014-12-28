
var debug = require('debug')('mdns:lib');
var Networking = require('./networking');
var Daemon = require('./daemon');
var ServiceType = require('./service_type');
var pkg = require('../package.json');

/** @member {string} */
module.exports.version = pkg.version;
module.exports.name = pkg.name;

var daemon = module.exports.daemon = null;

/* @borrows Browser as Browser */
module.exports.Browser = require('./browser'); //just for convenience

/** @property {module:ServiceType~ServiceType} */
module.exports.ServiceType = ServiceType.ServiceType;

/** @property {module:ServiceType.makeServiceType} */
module.exports.makeServiceType = ServiceType.makeServiceType;

/** @function */
module.exports.tcp = ServiceType.protocolHelper('tcp');

/** @function */
module.exports.udp = ServiceType.protocolHelper('udp');

function getDeamon() {
  if (!daemon) {
    networking = new Networking();
    daemon = new Daemon(networking);
  }
  return daemon;
}


// module.exports._setDeamon = function (d) {
//   daemon = d;
// }

module.exports.start = function (next) {
  var d = getDeamon();
  d.start(next);
};

module.exports.stop = function (next) {
  if (daemon) {
    daemon.stop();
  }
}

module.exports.createBrowser = function (serviceType) {
  if (typeof serviceType === 'undefined') {
    serviceType = ServiceType.ServiceType.wildcard;
  }
  var d = getDeamon();
  return new module.exports.Browser(d, serviceType);
};

module.exports.resolveName = function (address, callback) {
  var d = getDeamon();
  d.resolveName(address, callback);
};

module.exports.serviceDetails = function (serviceType, address, callback) {
  getDeamon().serviceDetails(serviceType, address, callback);
};

module.exports.getHosts = function (callback) {
  var d = getDeamon()
  d.db.find({}, {address: 1, fullname: 1}, callback);
};

module.exports.getServices = function (callback) {
  var d = getDeamon();
  var services = {};
  d.db.find({}, {address: 1, services: 1}, function (err, docs) {
    if (err) {
      return callback(err, null);
    }
    docs.forEach(function (doc) {
      if (!doc.services) {
        return;
      }
      doc.services.forEach(function (service) {
        if (services.hasOwnProperty(service)) {
          services[service].push(doc.address);
        }
        else {
          services[service] = [doc.address];
        }
      })
    });
    return callback(null, services);
  });
};


