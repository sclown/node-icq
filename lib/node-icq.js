var ICQ, DEFAULTS,
	fs = require('fs'),
	util = require('util'),
	eventEmitter = require('events').EventEmitter,
	events = new(require('events').EventEmitter)(),
	request = require('request'),
	extend = require('extend'),
	qs = require('querystring'),
	sort = require('sort-object');
var JSONbig = require('json-bigint');
var BigNumber = require('bignumber.js');
var path = require('path');
var urlparser = require('url');
var log4js = require('log4js');
try {
	log4js.configure('log4js.json');
} catch (e) {
}
var logger = log4js.getLogger('WIM');

var appName = 'icq'

DEFAULTS = {
	URL: {
		CLIENT_LOGIN: 'https://api.login.icq.net/auth/clientLogin',
		PREVIEW: 'https://api.icq.net/preview/getPreview',
		FILE_BASE: 'https://api.icq.net/files',
		RAPI_BASE: 'https://rapi.icq.net',
		API_BASE: 'https://api.icq.net',
		API_ENDPOINTS: {
			START_SESSION: '/aim/startSession',
			END_SESSION: '/aim/endSession',
			SEND_MESSAGE: '/im/sendIM',
			ADD_USER: '/buddylist/addBuddy',
			GET_PRESENCE: '/presence/get',
			SET_STATE: '/presence/setState',
			UPDATE_MEMBERS_DIR: '/memberDir/update',
			FILE_GATEWAY: '/files/init',
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
		if (err || res && res.statusCode!=200) {
			events.emit('session:nofetch', self);
			return;
		}
		body = JSONbig.parse(body);
		if (!body || !body.response || !body.response.data) {
			events.emit('session:fail', self, payload, body && body.response);
			return;
		}
		var i;

		body = body.response;
		self.fetchUrl = body.data.fetchBaseURL;
		self.ts = body.data.ts;
		for (i = 0; i < body.data.events.length; i++) {
			evnt = body.data.events[i]; 

			switch (evnt.type) {
                case "histDlgState":
					events.emit('im:histDlgState', self, evnt.eventData);
                    // for (msgIndex = 0; msgIndex < evnt.eventData.messages.length; msgIndex++) {
                    // 	if( parseInt(evnt.eventData.messages[msgIndex].msgId) > self.historyState[data.uin].msgId) {
                    //         data.text = data.message = evnt.eventData.messages[msgIndex].text;
					// 		if(evnt.eventData.messages[msgIndex].outgoing === true) {
	                //             events.emit('im:mymessage', self, data);
					// 		}
					// 		else {
	                //             events.emit('im:message', self, data);
					// 		}
                    //         self.historyState[data.uin].msgId = evnt.eventData.messages[msgIndex].msgId;
                    // 	}
                    // }
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
	if (!this.auth.hasAimsid()) {
		return false;
	}

	payload.r = requestId();
	payload = extend(payload, params.payload);
	payload.aimsid = payload.aimsid || this.auth.aimsid;

	logger.info("API request:" + DEFAULTS.URL.API_BASE + endpoint + " " + JSON.stringify(payload) + " " + params.body);
	var options = {
		json: true,
		url: DEFAULTS.URL.API_BASE + endpoint,
		qs: payload
	}
	if(params.json !== undefined) {
		options.json = params.json;
	}
	if(params.headers) {
		options.headers = params.headers;
	}
	if(params.body) {
		options.body = params.body;
	}

	if(params.httpMethod=='GET') {
		request.get(options, requestCallback);

	} else {
		request.post(options, requestCallback);
		
	}
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
	payload.a = this.auth.a;
	payload.ts = this.ts;
	payload.k = this.k;

	payload = sort(payload);
	payload.sig_sha256 = require('crypto').createHmac('sha256', this.auth.sessionKey)
		.update( params.httpMethod + '&' + encodeURIComponent(params.url) + '&' + encodeURIComponent(qs.stringify(payload)))
		.digest('base64');
	var options = {
		url: params.url,
		qs: payload
	}
	if(params.json) {
		options.json = true;
	}
	if(params.headers) {
		options.headers = params.headers;
	}
	if(params.body) {
		options.body = params.body;
	}

	if(params.httpMethod=='GET') {
		request.get(options, requestCallback);

	} else {
		request.post(options, requestCallback);
		
	}
}


// request = request.defaults({
// 	json: true
// });

AuthInfo = function(store) {
	this.uin = store.uin;
	this.password = store.password;
	this.a = store.a;
	this.sessionKey = store.sessionKey;
	this.aimsid = store.aimsid;
	this.authToken = store.authToken;
	this.clientId = store.clientId;

	this.hasAuth = function() {
		return !!(this.a && this.sessionKey);
	}
	this.hasAimsid = function() {
		return !!this.aimsid;
	}
	this.hasRAPIToken = function() {
		return !!this.authToken;
	}
	this.hasClient = function() {
		return !!this.clientId;
	}
}

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
	self.ts = parseInt(Date.now() / 1000);
	self.auth = new AuthInfo(params);
	self.apiRequest = apiRequest.bind(self);
	self.signedRequest = signedRequest.bind(self);
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
	// if(self.auth.hasAimsid()) {
	// 	fetchEvents.call(self);
	// 	return;
	// }
	if(self.auth.hasAuth()) {
		self.startSession()
		return;
	}
	self.clientLogin();

};

/**
 * Disconnect from ICQ servers
 *
 */
ICQ.prototype.disconnect = function () {
	var self = this;
	var payload = extend({}, DEFAULTS.PAYLOAD.GENERAL);

	payload.aimsid = self.auth.aimsid;
	payload.r = requestId();
	payload.k = self.k;

	request.post({
		json: true,
		url: DEFAULTS.URL.API_BASE + DEFAULTS.URL.API_ENDPOINTS.END_SESSION,
		qs: payload
	}, function (err, res, body) {
		if (err) {
			throw new Error(err);
		}

		self.fetchUrl = null;
		self.auth.aimsid = null;
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

ICQ.prototype.clientLogin = function () {
	var self = this;
	var payload = extend({}, DEFAULTS.PAYLOAD.GENERAL);

	payload.s = self.uin;
	payload.pwd = self.password;
	payload.k = self.k;
	payload.devId = self.k;
	payload.tokenType = 'longterm';
	payload.idType = 'ICQ';
	payload.service = appName

	logger.info("clientLogin query:" + JSON.stringify(payload));
	request.post({
		json: true,
		url: DEFAULTS.URL.CLIENT_LOGIN,
		qs: payload
	}, function (err, res, body) {
		logger.info("clientLogin result:" + JSON.stringify(err) + " " + JSON.stringify(res));
		if (err) {
			events.emit('session:fail', self, payload, err);
			throw new Error(err);
		}

		if (parseInt(body.response.statusCode) !== 200) {
			events.emit('session:fail', self, payload, body.response);
		} else {
			body = body.response;

			self.ts = body.data.hostTime;
			self.tsDiff =  Math.round((new Date()).getTime() / 1000) - self.ts;
			self.secret = body.data.sessionSecret;
			self.auth.a = body.data.token.a;
			self.auth.sessionKey = require('crypto').createHmac('sha256', self.password)
					.update(self.secret).digest('base64');
					
			self.startSession();

		}

	});
}

ICQ.prototype.startSession = function () {
	var self = this;
	var sessionPayload = extend({}, DEFAULTS.PAYLOAD.STARTS_SESSION);
	sessionPayload.view = 'online';
	sessionPayload.invisible = false;
	sessionPayload.mobile = 0;
	if(self.auth.hasAimsid()) {
		sessionPayload.aimsid = self.auth.aimsid;
	}

	logger.info("startSession query:" + JSON.stringify(sessionPayload));
	self.signedRequest({
		httpMethod: 'GET',
		json: true,
		url: DEFAULTS.URL.API_BASE + DEFAULTS.URL.API_ENDPOINTS.START_SESSION,
		payload: sessionPayload,
		requestCallback: function (err, res, body) {
				logger.info("startSession result:" + JSON.stringify(err) + " " + JSON.stringify(res));
				body = body.response;
				self.auth.aimsid = body.data.aimsid;
				self.fetchUrl = body.data.fetchBaseURL;
				self.ts = body.data.ts;
				events.emit('session:start', self);
			}
	});
}

ICQ.prototype.genToken = function (success) {
	var self = this;
    self.signedRequest({
        httpMethod: 'POST',
		json: true,
        url: DEFAULTS.URL.RAPI_BASE + '/genToken',
        payload: {},
        requestCallback: function (err, res, body) {
            self.auth.authToken = body.results.authToken;
            events.emit('session:token', self);
        }
    });
}

ICQ.prototype.addClient = function () {
	var self = this;
	self.rapiRequest('addClient', {
            ua:{
                app:appName,
                os:'web',
                version:'0.1',
                build:'1',
                label:'node-icq'
            }
        }, function(body) {
			self.auth.clientId = body.results.clientId || null;
			events.emit('session:client', self);
	});
}

ICQ.prototype.rapiRequest = function (method, params, success) {
	var self = this;
	var payload = {
        method:method,
        reqId: '' +requestId() + '-' + Math.round((new Date()).getTime() / 1000),
        authToken: self.auth.authToken,
        params: params
    };
	if(self.auth.hasClient) {
		payload.clientId = self.auth.clientId;
	}
	logger.info("RAPI request:" + JSON.stringify(payload));
	request.post({
		url: DEFAULTS.URL.RAPI_BASE,
		form: JSONbig.stringify(payload)
	}, function (err, res, body) {
		if (err) {
			throw new Error(err);
		}
		logger.info("RAPI result:" + JSON.stringify(err) + " " + JSON.stringify(res));
		body = JSONbig.parse(body)
		switch(body.status.code) {
			case 40200:
			case 40201: 
				self.auth.authToken = "";
				events.emit('session:bad_token', self);
				return;
			case 40300: 
			case 40301: 
				self.auth.clientId = "";
				events.emit('session:bad_client', self);
				return;
			case 20000:
		        success.call(self, body);			
			
			default: 
				var check=0;
				break;				
		}
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

ICQ.prototype.setNickname = function (nick) {
	this.updateMembersDir({friendlyName:nick});
}

ICQ.prototype.setAbout = function (about) {
	this.updateMembersDir({aboutMe:about});
}

ICQ.prototype.getHistory = function (uin, from, to, cb) {
	var self = this;
	self.rapiRequest('getHistory', {
			sn:uin,
			patchVersion:'init',
            subreqs:[ {
				id:'hist',
				fromMsgId:from,
				tillMsgId:to,
				count:1000
			} ]
        }, function(body) {
			var messages = [];
			try {
				messages = body.results.subresps[0].messages;
			} catch (e) {
			}
			cb(messages);
	});
}

ICQ.prototype.setDlgState = function (uin, delivered, read) {
	var self = this;
	self.rapiRequest('setDlgStateWim', {
			sn:uin,
			lastDelivered: delivered,
			lastRead: read,
			invisible: false
        }, function(body) {
			var a=0;
	});
}

ICQ.prototype.send = function (uin, message, options) {
	var self = this;
	function sendNext() {
		if(!self.sendQueue.length) {
			return;
		}
		var next = self.sendQueue[0];
		self.messageSend(next.uin, next.message, next.options, function() {
			setTimeout(function() {
				self.sendQueue.shift();
				sendNext();
			}, 3000);
		});
	}
	this.sendQueue.push({uin:uin, message:message, options: options});
	if(this.sendQueue.length==1)
	{
		sendNext();
	}
};

ICQ.prototype.messageSend = function (uin, message, options, callback) {
	var payload = {
		t: uin,
		notifyDelivery: 0		
	};
	if(options && options.telechat==true) {
		payload.telechat = 1;
	} 
	if(options && options.snippets) {
		payload.snippets = JSON.stringify(options.snippets);
	} 
	this.apiRequest({
		httpMethod: 'POST',
		json: false,
		headers: {
			'content-type': 'text/plain',
		},
		payload: payload,
		body: message,
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

ICQ.prototype.getSnippet = function (url, callback) {
	var self = this;
	var previewPayload = extend({}, DEFAULTS.PAYLOAD.GENERAL);
	previewPayload.client = 'icq';
	previewPayload.url = url;
	previewPayload.images_cnt = "1";
	self.signedRequest({
		httpMethod: 'GET',
		json: true,
		url: DEFAULTS.URL.PREVIEW,
		payload: previewPayload,
		requestCallback: function (err, res, body) {
			callback(body)
		}
	});
};

ICQ.prototype.imageUpload = function (file, isSnap, callback) {
	var self = this;
	var stats = fs.statSync(file);
 	var fileSizeInBytes = stats["size"];
	var range = '0-' + (fileSizeInBytes-1) + '/' + fileSizeInBytes; 
	var name = path.basename(file);

	var sessionPayload = extend({}, DEFAULTS.PAYLOAD.GENERAL);
	sessionPayload.size = '' + fileSizeInBytes;
	sessionPayload.filename = name;
	sessionPayload.client = 'icq';
	if( isSnap ) {
		sessionPayload.is_snap = 'true';
		sessionPayload.ttl = '86400';
	}
	self.signedRequest({
		httpMethod: 'POST',
		json: true,
		url: DEFAULTS.URL.FILE_BASE + DEFAULTS.API_ENDPOINTS.FILE_GATEWAY,
		payload: sessionPayload,
		requestCallback: function (err, res, body) {
				body = body.data;
				var upload_url = "https://" + body.host + body.url;
				var uploadPayload = extend({}, DEFAULTS.PAYLOAD.GENERAL);
				uploadPayload.size = '' + fileSizeInBytes;
				uploadPayload.filename = name;
				uploadPayload.client = 'icq';
				uploadPayload.lastChunk = true;
				self.signedRequest({
					httpMethod: 'POST',
					url: upload_url,
					payload: uploadPayload,
					headers: {
						'content-type': 'application/octet-stream',
						'Content-Range': 'bytes ' + range,
						'X-Content-Range': 'bytes ' + range						
					},
					body: fs.createReadStream(file),
					requestCallback: function(err, res, body) {
						body = JSON.parse(body);
						callback(body.data.static_url, body.data.ttl_id);
					}
				});
			}
	});
};

ICQ.prototype.downloadFile = function (url, dir, callback) {
	var self = this;
	var fileId = path.basename(urlparser.parse(url).pathname);
	request.get({
		json: true,
		url: DEFAULTS.URL.FILE_BASE + '/getinfo?file_id=' + fileId,
	}, function(err, res, body) {
		var dlink = body.file_list[0].dlink;
		var fileName = path.basename(urlparser.parse(dlink).pathname);
		var filePath = dir + fileName;
		var dest = fs.createWriteStream(filePath);
		dest.on('finish', function(){
			callback(filePath);
		})
		request.get(dlink)
			.on('error', function(err) {
				console.log(err)
			})
			.pipe(dest);
	});
};



/**
 * Session started successfully
 *
 * @event ICQ#session:start
 */
events.on('session:start', function (ctx) {
	ctx.emit('session:start');
	fetchEvents.call(ctx);
	ctx.genToken(ctx);
});

events.on('session:bad_token', function (ctx) {
	ctx.emit('session:bad_token');
	ctx.genToken(ctx);
});

events.on('session:bad_client', function (ctx) {
	ctx.addClient(ctx);
	ctx.emit('session:bad_client');
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

        case 460: //MISSING_REQUIRED_PARAMETER_460:
        case 462: //PARAMETER_ERROR_462:
        	ctx.emit('session:bad_request', statusCode, params);
			return;
					
		case 400: //INVALID_REQUEST_400:
			if(parseInt(data.statusDetailCode) == 7) {
				ctx.emit('session:authn_required');
				return;
			}
			break;
		case 340: 
		case 401: 
		case 440: 
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

events.on('session:nofetch', function (ctx) {
	setTimeout(function() {
		ctx.startSession();
	}, 5000);
});

events.on('im:histDlgState', function (ctx, data) {
	logger.info("im:histDlgState:" + JSON.stringify(data.messages));
	if(!data.messages) {
		return;
	}
	var uin = data.sn;
	var msg = {uin: uin};
	if(!ctx.historyState[uin]) {
		ctx.historyState[uin] = {lastMsgId:0};
	}
	for (var msgIndex = 0; msgIndex < data.messages.length; msgIndex++) {
		if( parseInt(data.messages[msgIndex].msgId) > ctx.historyState[uin].lastMsgId) {
			msg.class = data.messages[msgIndex].class;
			if(data.messages[msgIndex].chat) {
				msg.sender = data.messages[msgIndex].chat.sender;
			}
			msg.outgoing = data.messages[msgIndex].outgoing;
			msg.text = data.messages[msgIndex].text || "";
			events.emit('im:message', ctx, msg);
			ctx.historyState[uin].lastMsgId = data.messages[msgIndex].msgId;
		}
	}
	ctx.setDlgState(uin, ctx.historyState[uin].lastMsgId, ctx.historyState[uin].lastMsgId);
});

events.on('im:message', function (ctx, data) {
	ctx.emit('im:message', data);
});

events.on('im:mymessage', function (ctx, data) {
	ctx.emit('im:mymessage', data);
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
