/*eslint no-console: 0*/


var mdns = require('../lib');

var browser = mdns.createBrowser();
var once = true;
var s;
browser.on('serviceUp' , function (service) {
  console.log('service up', service.service.name, service.service.toString(), service.address);
});

browser.on('serviceDown' , function (service) {
  console.log('service down', service.service.toString());
});


browser.start();

setInterval(function () {
  mdns.getHosts(function (err, hosts) {

    var index = 0;
    function resolve() {
      if (index >= hosts.length) {return;}
      var host = hosts[index++];
      if (!hosts.fullname) {
        mdns.resolveName(host.address, function () {
          resolve();
        });
      }
      else {
        resolve();
      }
    }
  });
   mdns.getServices(function (err, services) {
    detailServices(services);
  });
}, 10000);

function detailServices(services) {
  var index = 0;
  var keys = Object.keys(services);
  setTimeout(resolve, 500);

  function resolve() {
    if (index >= keys.length) {return;}
    var service = keys[index++];
    console.log('getting details for %s', service);
    var addresses = services[service];

    addresses.forEach(function (a) {
      mdns.serviceDetails(service, a);
    });
    setTimeout(resolve, 500);
  }

}


// read from stdin
process.stdin.resume();

// stop on Ctrl-C
process.on('SIGINT', function () {
  mdns.stop();

  // give deregistration a little time
  setTimeout(function onTimeout() {
    process.exit();
  }, 1000);
});
