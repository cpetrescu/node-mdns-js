
var debug = require('debug')('mdns:lib:browser');

var util = require('util');
var EventEmitter = require('events').EventEmitter;

var ServiceType = require('./service_type').ServiceType;

// var counter = 0;
var internal = {};



/**
 * mDNS Browser class
 * @class
 * @param {string|ServiceType} serviceType - The service type to browse for.
 * @fires Browser#update
 */
var Browser = module.exports = function (daemon, serviceType) {
  if (!(this instanceof Browser)) { return new Browser(daemon, serviceType); }
  debug('new Browser instance', serviceType);
  var notString = typeof serviceType !== 'string';
  var notType = !(serviceType instanceof ServiceType);
  if (notString && notType) {
    debug('serviceType type:', typeof serviceType);
    debug('serviceType is ServiceType:', serviceType instanceof ServiceType);
    debug('serviceType=', serviceType);
    throw new Error('argument must be instance of ServiceType or valid string');
  }
  if (typeof serviceType === 'string') {
    this.serviceType = new ServiceType(serviceType);
  }
  else {
    this.serviceType = serviceType;
  }

  this.stop = function () {
    daemon.removeBrowser(this);
  };//--start

  this.daemon = daemon;

};//--Browser constructor

util.inherits(Browser, EventEmitter);

Browser.prototype.start = function(first_argument) {
  this.daemon.addBrowser(this, function () {
      this.emit('browser ready');
    }.bind(this));
};


Browser.prototype.onServiceUp = function (obj) {
  debug('onServiceUp', obj);
  this.emit('serviceUp', obj);
}

