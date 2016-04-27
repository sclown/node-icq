var ICQ, DEFAULTS,
	fs = require('fs'),
	util = require('util'),
	eventEmitter = require('events').EventEmitter,
	events = new(require('events').EventEmitter)(),
	request = require('request'),
	extend = require('extend'),
	qs = require('querystring'),
	sort = require('sort-object');
var log4js = require('log4js');
try {
	log4js.configure('log4js.json');
} catch (e) {
}
var logger = log4js.getLogger('WIM');

DEFAULTS = {
	URL: {
		CLIENT_LOGIN: 'https://api.login.icq.net/auth/clientLogin',
		FILE_UPLOAD: 'http://files.icq.com/files/add',
		FILE_GATEWAY: 'http://files.icq.com/files/init',
		API_BASE: 'http://api.icq.net',
		API_ENDPOINTS: {
			START_SESSION: '/aim/startSession',
			END_SESSION: '/aim/endSession',
			SEND_MESSAGE: '/im/sendIM',
			ADD_USER: '/buddylist/addBuddy',
			GET_PRESENCE: '/presence/get',
			SET_STATE: '/presence/setState',
			UPDATE_MEMBERS_DIR: '/memberDir/update',
		}
	},
	PAYLOAD: {
		GENERAL: {
			f: 'json',
		},
		STARTS_SESSION: {
			events: 'mchat,userAddedToBuddyList,hist,imState,buddylist',
			includePresenceFields: 'aimId,friendly,state,ssl',
			sessionTimeout: '2592000'
		},
	},
};

function fetchEvent(callback) {
	var self = this;
	var payload = extend({}, DEFAULTS.PAYLOAD.GENERAL);
	payload.peek = 0;
	payload.timeout = 30000;
	payload.r = parseInt('' + (Date.now() / 1000 | 0) + '0' + parseInt(Math.random() * 1000));

	callback = callback || function () {};
	logger.info("Fetch request:" + self.fetchUrl + " " + JSON.stringify(payload));

	request.get({
		url: self.fetchUrl,
		qs: payload
	}, function (err, res, body) {
		logger.info("Fetch result:" + JSON.stringify(err) + " " + JSON.stringify(res));
		if (!body || !body.response || !body.response.data) {
			events.emit('session:fail', self, payload, body && body.response);
			return;
		}
		var i, data, messageType;

		body = body.response;
		self.fetchUrl = body.data.fetchBaseURL;
		for (i = 0; i < body.data.events.length; i++) {
			data = {};
			messageType = 'message';
			evnt = body.data.events[i]; 

			switch (evnt.type) {
                case "histDlgState":
                    data.uin = evnt.eventData.sn;
                    var msgIndex;
                    if (!body.data.events[i].eventData.messages)
                    	break;
                    if(!self.historyState[data.uin]) {
                    	self.historyState[data.uin] = {msgId:0};
                    }
                    for (msgIndex = 0; msgIndex < evnt.eventData.messages.length; msgIndex++) {
                    	if( parseInt(evnt.eventData.messages[msgIndex].msgId) > self.historyState[data.uin].msgId && !(evnt.eventData.messages[msgIndex].outgoing === true) ) {
                            data.text = data.message = evnt.eventData.messages[msgIndex].text;
                            events.emit('im:message', self, data);
                            self.historyState[data.uin].msgId = evnt.eventData.messages[msgIndex].msgId;
                    	}
                    }
                    break;

				case "userAddedToBuddyList":
					events.emit('im:auth_request', self, { uin: evnt.eventData.requester });
					break;

				case "presence":
					events.emit('session:presence', self, body.data.events[i]);
					break;

				case "buddylist":
					events.emit('session:contact_list_update', self, body.data.events[i]);
					break;

				case "sessionEnded":
					events.emit('session:end', self, body.data.events[i].eventData.endCode);
					break;

				default:
					events.emit('session:event', self, body.data.events[i]);
			}
		}
		callback();
	});
}

function fetchEvents() {
	var self = this;
	if (self.fetchUrl) {
		setTimeout(function () {
			fetchEvent.call(self, function () {
				fetchEvents.call(self);
			});
		}, 1100);
	}
}

function requestId() {
	return parseInt(1000000 + Math.random() * 1000);	
}

function apiRequest(params) {
	params = params || {};
	var self = this;
	var payload = extend({}, DEFAULTS.PAYLOAD.GENERAL);
	var endpoint = params.endpoint || false;
	var	callback = params.callback || function () {};
	var requestCallback = params.requestCallback || function (err, res, body) {
			logger.info("API result:" + JSON.stringify(err) + " " + JSON.stringify(res));
			if (err || !body) {
				callback(err || null);
				events.emit('session:fail', self, params, err);
			} else if (!body.response || parseInt(body.response.statusCode) !== 200) {
				callback(body.response);
				events.emit('session:fail', self, params, body.response);
			} else {
				callback(body.response.data);
			}
		};

	if (!endpoint) {
		return false;
	}
	if (!this.aimsid) {
		return false;
	}

	payload.r = requestId();
	payload = extend(payload, params.payload);
	payload.aimsid = payload.aimsid || this.aimsid;

	logger.info("API request:" + DEFAULTS.URL.API_BASE + endpoint + " " + JSON.stringify(payload));
	request.post({
		url: DEFAULTS.URL.API_BASE + endpoint,
		qs: payload
	}, requestCallback);
}

function signedRequest(params) {
	params = params || {};

	var payload = extend({}, DEFAULTS.PAYLOAD.GENERAL);
	var	callback = params.callback || function () {};
	var requestCallback = params.requestCallback || function (err, res, body) {
			if (err || !body) {
				callback(err || null);
			}

			if (!body.response || parseInt(body.response.statusCode) !== 200) {
				callback(body.response);
			} else {
				callback(body.response.data);
			}
		};

	payload = extend(payload, params.payload);
	payload.r = parseInt('' + (Date.now() / 1000 | 0) + '0' + parseInt(Math.random() * 1000));
	payload.a = this.a;
	payload.ts = this.ts;
	payload.k = this.k;

	payload = sort(payload);
	payload.sig_sha256 = require('crypto').createHmac('sha256', this.sessionKey)
		.update( params.httpMethod + '&' + encodeURIComponent(params.url) + '&' + encodeURIComponent(qs.stringify(payload)))
		.digest('base64');

	if(params.httpMethod=='GET') {
		request.get({
			url: params.url,
			qs: payload
		}, requestCallback);

	} else {
		request.post({
			url: params.url,
			qs: payload
		}, requestCallback);
		
	}
}


function fileUpload(params) {
	params = params || {};

	var payload = {},
		self = this,
		callback = params.callback || function () {},
		requestCallback = params.requestCallback || function (err, res, body) {
			if (err) {
				callback(err);
			}

			if (!body.file_list || parseInt(body.status) !== 200) {
				callback(body);
			} else {
				callback(body.file_list);
			}
		};

	payload.r = parseInt(1000000 + Math.random() * 1000000);
	payload = extend(payload, params.payload);
	payload.a = self.a;
	payload.k = self.k;
	payload.ts = parseInt(+new Date()/1000) - self.tsDiff;

	payload.size = '1000';
	payload.filename = 'test.jpg';
	payload.client = 'icq';

	payload = sort(payload);

	payload.sig_sha256 = require('crypto')
		.createHmac('sha256', require('crypto').createHmac('sha256', self.password)
			.update(self.secret).digest('base64'))
		.update('POST&' + encodeURIComponent(DEFAULTS.URL.FILE_UPLOAD) + '&' + encodeURIComponent(qs.stringify(
			payload)))
		.digest('base64');

	var r = request.post({
		url: DEFAULTS.URL.FILE_UPLOAD,
		qs: payload
	}, requestCallback);

	try {
		fs.createReadStream(params.file).pipe(r);
	} catch (e) {
		callback(e);
	}
}

request = request.defaults({
	json: true
});

ICQ = function (params) {
	if (!(this instanceof ICQ)) {
		return new ICQ(params);
	}
	var self = this;

	if (!params || !params.uin || !params.password || !params.token) {
		throw new Error('No required params for init');
	}

	self.uin = params.uin;
	self.password = params.password;
	self.k = params.token;
	self.apiRequest = apiRequest.bind(self);
	self.signedRequest = signedRequest.bind(self);
	self.fileUpload = fileUpload;
	self.historyState = {};
	self.sendQueue = [];
	eventEmitter.call(self);
};

util.inherits(ICQ, eventEmitter);


/**
 * Connect to ICQ server
 *
 */
ICQ.prototype.connect = function () {
	var self = this;
	var payload = extend({}, DEFAULTS.PAYLOAD.GENERAL);

	payload.s = self.uin;
	payload.pwd = self.password;
	payload.k = self.k;
	payload.devId = self.k;
	payload.tokenType = 'longterm';
	payload.idType = 'ICQ';

	request.post({
		url: DEFAULTS.URL.CLIENT_LOGIN,
		qs: payload
	}, function (err, res, body) {
		if (err) {
			events.emit('session:fail', self, payload, err);
			throw new Error(err);
		}

		if (parseInt(body.response.statusCode) !== 200) {
			events.emit('session:fail', self, payload, body.response);
		} else {
			body = body.response;

			self.a = body.data.token.a;
			self.ts = body.data.hostTime;
			self.tsDiff =  Math.round((new Date()).getTime() / 1000) - self.ts;
			self.secret = body.data.sessionSecret;
			self.sessionKey = require('crypto').createHmac('sha256', self.password)
					.update(self.secret).digest('base64');

			var sessionPayload = extend({}, DEFAULTS.PAYLOAD.STARTS_SESSION);
			sessionPayload.view = 'online';
			sessionPayload.invisible = false;
			sessionPayload.mobile = 0;

			self.signedRequest({
				httpMethod: 'GET',
				url: DEFAULTS.URL.API_BASE + DEFAULTS.URL.API_ENDPOINTS.START_SESSION,
				payload: sessionPayload,
				requestCallback: function (err, res, body) {
						body = body.response;
						self.aimsid = body.data.aimsid;
						self.fetchUrl = body.data.fetchBaseURL;
						events.emit('session:start', self);
					}
			});
		}

	});
};

/**
 * Disconnect from ICQ servers
 *
 */
ICQ.prototype.disconnect = function () {
	var self = this;
	var payload = extend({}, DEFAULTS.PAYLOAD.GENERAL);

	payload.aimsid = self.aimsid;
	payload.r = requestId();
	payload.k = self.k;

	request.post({
		url: DEFAULTS.URL.API_BASE + DEFAULTS.URL.API_ENDPOINTS.END_SESSION,
		qs: payload
	}, function (err, res, body) {
		if (err) {
			throw new Error(err);
		}

		self.fetchUrl = null;
		self.aimsid = null;
		self.sendQueue = [];

		if (parseInt(body.response.statusCode) !== 200) {
			events.emit('session:end', self);
		} else {
			events.emit('session:end', self);
		}
	});
};

ICQ.prototype.reconnect = function (timeout) {
	var self = this;
	self.disconnect();
	setTimeout(function() {
		self.connect();
	}, timeout);
};

ICQ.prototype.genToken = function (success) {
	var self = this;
    self.signedRequest({
        httpMethod: 'POST',
        url: 'https://rapi.icq.net/genToken',
        payload: {},
        requestCallback: function (err, res, body) {
            self.authToken = body.results.authToken;
            events.emit('session:token', self);
        }
    });
}

ICQ.prototype.addClient = function () {
	var self = this;
	self.rapiRequest('addClient', {
            ua:{
                app:'icq',
                os:'web',
                version:'0.1',
                build:'1',
                label:'node-icq'
            }
        }, function(body) {
			self.clientId = body.results.clientId || null;
			events.emit('session:client', self);
	});
}

ICQ.prototype.rapiRequest = function (method, params, success) {
	var self = this;
	var payload = {
        method:method,
        reqId: '' +requestId() + '-' + Math.round((new Date()).getTime() / 1000),
        authToken: self.authToken,
        params: params
    };
	if(self.clientId) {
		payload.clientId = self.clientId;
	}
	request.post({
		url: 'https://rapi.icq.net',
		form: JSON.stringify(payload)
	}, function (err, res, body) {
		if (err) {
			throw new Error(err);
		}
        success.call(self, body);
	});
}


/**
 * Get info about ICQ user
 *
 * @param {string} uin - User uin
 * @param {callback_users} callback - Callback function
 */
ICQ.prototype.presenceGet = function (uin, callback) {
	this.apiRequest({
		payload: {
			t: uin,
			capabilities: 1,
			mdir: 1
		},
		endpoint: DEFAULTS.URL.API_ENDPOINTS.GET_PRESENCE,
		callback: callback
	});
};

ICQ.prototype.setState = function (state, callback) {
	this.apiRequest({
		payload: {
			view: state
		},
		endpoint: DEFAULTS.URL.API_ENDPOINTS.SET_STATE,
		callback: callback
	});
};

ICQ.prototype.updateMembersDir = function (data, callback) {
	this.apiRequest({
		payload: {
			set: qs.stringify(data)
		},
		endpoint: DEFAULTS.URL.API_ENDPOINTS.UPDATE_MEMBERS_DIR,
		callback: callback
	});
};

ICQ.prototype.usersAdd = function (uin, callback) {
	this.apiRequest({
		payload: {
			buddy: uin,
			group: 'General',
			authorizationMsg: '""',
			preAuthorized: true
		},
		endpoint: DEFAULTS.URL.API_ENDPOINTS.ADD_USER,
		callback: callback
	});
};


ICQ.prototype.send = function (uin, message) {
	var self = this;
	function sendNext() {
		if(!self.sendQueue.length) {
			return;
		}
		var next = self.sendQueue[0];
		self.messageSend(next.uin, next.message, function() {
			setTimeout(function() {
				self.sendQueue.shift();
				sendNext();
			}, 3000);
		});
	}
	this.sendQueue.push({uin:uin, message:message});
	if(this.sendQueue.length==1)
	{
		sendNext();
	}
};

ICQ.prototype.messageSend = function (uin, message, callback) {
	this.apiRequest({
		payload: {
			t: uin,
			message: message,
			notifyDelivery: 0
		},
		endpoint: DEFAULTS.URL.API_ENDPOINTS.SEND_MESSAGE,
		callback: callback
	});
};

ICQ.prototype.appSend = function (uin, data, fallback, callback) {
	this.apiRequest({
		payload: {
			t: uin,
			message: fallback,
			apps_data: JSON.stringify(data),
			notifyDelivery: 0
		},
		endpoint: DEFAULTS.URL.API_ENDPOINTS.SEND_MESSAGE,
		callback: callback
	});
};

ICQ.prototype.imageUpload = function (file, callback) {
	this.fileUpload({
		file: file,
		callback: callback
	});
};




/**
 * Session started successfully
 *
 * @event ICQ#session:start
 */
events.on('session:start', function (ctx) {
	fetchEvents.call(ctx);
	ctx.emit('session:start');
	// ctx.genToken(ctx);
});

events.on('session:token', function (ctx) {
	ctx.addClient(ctx);
	ctx.emit('session:token');
});

events.on('session:client', function (ctx) {
	ctx.emit('session:client');
});

/**
 * Session finished
 *
 * @event ICQ#session:end
 */
events.on('session:end', function (ctx, data) {
	fetchEvents.call(ctx);
	ctx.emit('session:end', data);
});

/**
 * Session fails
 *
 * @event ICQ#session:fail
 * @param {object} data - session fail details
 */
events.on('session:fail', function (ctx, params, data) {
	var statusCode = data && parseInt(data.statusCode);
    switch (statusCode) {
        case 430: //SOURCE_RATE_LIMIT_REACHED_430:
        	ctx.emit('session:rate_limit');
			return;

		case 400: //INVALID_REQUEST_400:
        case 460: //MISSING_REQUIRED_PARAMETER_460:
        case 462: //PARAMETER_ERROR_462:
        	ctx.emit('session:bad_request', statusCode, params);
			return;
					
		case 401: //AUTHN_REQUIRED_401:
        	ctx.emit('session:authn_required');
			return;
						
		case 408: //REQUEST_TIMEOUT_408: // backend timeout
		case 600: //INVALID_TARGET_600:
		case 601: //TARGET_DOESNT_EXIST_601:
		case 602: //TARGET_NOT_AVAILABLE_602:
		case 603: //TARGET_BLOCKED_603:
		case 604: //TARGET_NOT_ALLOWED_604:
		case 605: //TARGET_DOESNT_SUPPORT_REQUEST_605:
		case 606: //MESSAGE_TOO_BIG_FOR_TARGET_606:
		case 607: //TARGET_RATE_LIMIT_REACHED_607: // Рейтлимит у собеседника
        	ctx.emit('session:remote_problem', statusCode, params);
			return;
	}
	ctx.emit('session:fail', data);
});


events.on('im:message', function (ctx, data) {
	ctx.emit('im:message', data);
});

events.on('im:auth_request', function (ctx, data) {
	ctx.emit('im:auth_request', data);
});

events.on('session:contact_list', function (ctx, data) {
	ctx.emit('session:contact_list', data.groups);
});

events.on('session:presence', function (ctx, data) {
	data = data.eventData;
	ctx.emit('session:presence', data);
});

events.on('session:event', function (ctx, data) {
	ctx.emit('session:event', data);
});

module.exports = ICQ;
