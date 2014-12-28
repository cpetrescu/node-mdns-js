
var debug = require('debug')('mdns:advertisement');
var ServiceType = require('./service_type').ServiceType;



/**
 * mDNS Advertisement class
 * @class
 * @param {string|ServiceType} serviceType - The service type to register
 * @param {number} [port] - The port number for the service
 * @param {object} [options] - ...
 */
var Advertisement = module.exports = function (
  networking, serviceType, port, options) {
  if (!(this instanceof Advertisement)) {
    return new Advertisement(serviceType, port, options);
  }


  // TODO: check more parameters
  if (!('name' in options)) {
    throw new Error('options must contain the name field.');
  }
  var self = this;
  this.serviceType = serviceType;
  this.port = port;
  this.options = options;
  this.nameSuffix = '';
  this.alias = '';
  this.status = 0; // inactive


  this.start = function () {
    networking.addProbe(self, function () {
      debug('started advertisement');
    });
  };

  this.stop = function () {
    networking.removeProbe(self);
  };

  debug('created new service');
}; //--Advertisement constructor

