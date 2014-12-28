var Lab = require('lab');
var lab = exports.lab = Lab.script();

var describe = lab.describe;
var it = lab.it;
var before = lab.before;
//var after = lab.after;
var Code = require('code');   // assertion library
var expect = Code.expect;


var Networking = require('./mock/networking');
var Daemon = require('../lib/daemon');
var Browser = require('../lib/browser');
var ServiceType = require('../lib/service_type').ServiceType;

var helper = require('./helper');


function getLib(done) {
  var networking = new Networking();
  var daemon = new Daemon(networking);
  daemon.start(function () {
    done()
  });
  return {daemon: daemon, networking: networking};
}

describe('Daemon', function () {

  it('discover', function (done) {
    var lib = getLib(fn);

    function fn() {
      var s = ServiceType.wildcard;
      var b = new Browser(lib.daemon, s);
      b.discover();
    }

    lib.networking.on('mockSend', function (packet, options) {
      expect(options).to.deep.equal({multicast: true, unicast: false});
      expect(packet.question, 'question count').to.have.length(1);
      lib.networking.inject(helper.readBin('./test/fixtures/mdns-readynas.bin'));
      setTimeout(checkDump, 500);
    });

    function checkDump() {
      lib.daemon.dumpDb(function (err, docs) {
        console.log(docs);
        expect(docs).to.have.length(1);
        var doc = docs[0];
        expect(doc).to.include(['address', 'services', 'hostname']);
        expect(doc.services, 'number of services').to.have.length(13);
        done();
      });
    }
  });

});
