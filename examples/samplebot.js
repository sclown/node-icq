var request = require('request');
var log4js = require('log4js');
log4js.configure('log4js.json');
var logger = log4js.getLogger('out');

var ICQ = require(__dirname+'/..');

var im = new ICQ({
	"uin": "UIN",
    "password": "PASSWORD",
    "token": "ic17mFHiwr52TKrx"
});

im.on('session:start', function () {
	im.setState('online');
});

im.on('im:message', function(message) {
	var match = (/Say me\s*(.*)/).exec(message.text);
	if(match && match[1]) {
		im.send(message.uin, match[1].toUpperCase());
	}
});

if(im.uin != "UIN") {
	im.connect();
}
else {
	console.error("Replace UIN and PASSWORD with real uin and password");
}

process.on("SIGINT", function () {
	im.on('session:end', function (endCode) {
		process.exit();
	});
	im.disconnect();
});
