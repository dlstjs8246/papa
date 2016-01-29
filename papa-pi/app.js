/**
 * papa-pi ver 0.1.1
 * 
 */

var http = require('http');
var cookieParser = require('cookie-parser');
var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var socketio = require('socket.io');
var gcm = require('node-gcm');
var winston = require('winston');
winston.add ( winston.transports.File, {
	  level: 'debug',
	  json: false,
	  filename: '/home/pi/secompi/log/my.log',
	  timestamp: function(){
		  var now = new Date();
		  var year = now.getFullYear();
		  var month = now.getMonth() + 1;
		  var date = now.getDate();
		  var day = now.getDay();
		  var hour = now.getHours();
		  var min = now.getMinutes();
		  var sec = now.getSeconds();
		  var millis = now.getMilliseconds();
		  
		  function zf(n, len){
			  if(n < 10){
				  if(len == 3){
					  return '00' + n;
				  }
				  return '0' + n;
			  }else if(n < 100 && len ==3){
				  return '0' + n;
        }else{
          return n;
        }
		  }
		  var weekName = ['일', '월', '화', '수', '목', '금', '토'];
		  return year +"-"+ zf(month) + "-" + zf(date) +"(" +  weekName[day] +") "+ zf(hour)+":"+zf(min)+":"+zf(sec)+"." + zf(millis, 3);
		  
	  }

	});

winston.info('SecHome-pi running.');  
var message = new gcm.Message({
	collapseKey : 'PushProvider',
	delayWhileIdel :true,
	timeToLive :3,
	data:{
		title : 'SecHome',
		message : 'SecHome Server가 실행 되었습니다.',
		key1 : 'Hello SecomPi',
		key2 : 'Push message.'
	}
});

var server_key = 'AIzaSyC64fNRlatspr10chZuz4Ncy3hFSFCBzpc';
var sender = new gcm.Sender(server_key);
var regid = ['fI7P0ZnE7hQ:APA91bHYLaf64WVtvcyyKCqVJM_rEyxiiosHDCZmLC5afZKeTady0fnete520GCsUhqkscCPy3olP3jitiHv-nVcAFsdbTNNtdKD5ebRAN-etVjiF5aH9Jf11xvrAJ0X5FZXP2AxjJVu',
             'chEPdABo7O8:APA91bH7rrFDLdquAYGC_FrjxtILpVVNEY9hoqAghPWyQY2HQnSZ1twx_FMQLsRh9zZnR_oR5UD2mnTReH3-PQ0ruZwN_i_KtD3WaXESHNcACnVzilrNYRrGmwlghwtmi_9ARp5UKLYD'];

sender.send(message, regid, 4, function(err, result){
	winston.debug(result);
});
var serialport = require('serialport');
var SerialPort = serialport.SerialPort;
var fs = require('fs');

var serial = new SerialPort('/dev/ttyAMA0', {
	baudrate : 9600,
	parser : serialport.parsers.readline("\n")
});

var GPIO = require('onoff').Gpio;
var sensor_act = new GPIO(17, 'in', 'both');
var sensor_door = new GPIO(4, 'in', 'both');
var sensor_fire = new GPIO(27, 'in', 'both');
var sensor_ir = new GPIO(22, 'in', 'both');
var sw_ir = new GPIO(10, 'out');
var sw_alram = new GPIO(9, 'out');
var sw_door_lock = new GPIO(11, 'out');

var app = express();
var server = http.createServer(app);
var io = socketio(server);
console.log(session);
app.use(session({
	secret : 'keyboard cat',
	resave : false,
	saveUninitialized : true

}));
var users =[
            {id:'dltpdn', pwd :'rainMaker', name:'이세우', level : 10},
            {id:'io2005', pwd: '9090', name : '김은진', level:5}
            ]
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({
	extended : true
}));

var cardKeys = [ 'E1137034', '4FCF3319', '6121491', '85E8B27', 'A14C6A34', '61021491' ];

var mode = 'NOR'; // NOR, SLP, OUT
var status = {
	door : 0,
	act : 0,
	fire : 0,
	ir : -1
};
var lastStatus = {};
var ir_just_on = false;

process.on('SIGINT', function() {
	winston.info('SecHome-pi service exit...');
	sensor_act.unexport();
	sensor_door.unexport();
	sensor_fire.unexport();
	sensor_ir.unexport();
	sw_ir.unexport();
	sw_alram.unexport();
	sw_door_lock.unexport();
	process.exit();
});

sensor_act.watch(function(err, state) {
	if (err) {
		winston.error('err on act:' + err);
	} else {
		status.act = state;
		checkStatus();
	}
});
sensor_door.watch(function(err, state) {
	if (err) {
		winston.error('err on door:' + err);
	} else {
		status.door = state;
		checkStatus();
	}
});
sensor_fire.watch(function(err, state) {
	if (err) {
		winston.error('err on fire:' + err);
	} else {
		status.fire = state;
		checkStatus();
	}
});

function checkStatus() {
	winston.info('mode:' + mode);
	reportStatus();
	if (status.fire) {
		notifyAlram({
			msg : '화재 발생!'
		});
	}
	if ((status.door || status.ir) && mode != 'NOR') {
		if (status.door) {
			notifyAlram({
				msg : '현관문으로 침입이 감지 되었습니다!'
			});
		}
		if (status.ir === 1) {
			notifyAlram({
				msg : '거실창에서 침입이 감지 되었습니다!'
			});
		}
	}
	if (status.act && mode === 'OUT') {
		notifyAlram({
			msg : '실내에 움직임이 감지 되었습니다!'
		});
	}
}

function getUser(id, pwd){
	for(var i=0; i<users.length; i++){
		if(users[i].id === id && users[i].pwd === pwd){
			return users[i];
		}
	}
} 

app.post('/api/login.do', function(req, res) {
	winston.info(req.url);
	var id = req.body.id;
	var pwd = req.body.pwd;
	var user = getUser(id, pwd); 
	if (user) {
		console.log('login.do1:' + JSON.stringify(req.session));
		req.session.user = user;
		console.log('login.do2:' + JSON.stringify(req.session));
		res.send({
			code : 0,
			value : '/index.html'
		});
	} else {
		res.send({
			code : -1,
			value : 'ID와 비밀번호가 틀립니다.'
		});
	}
});
app.get('/api/logout.do', function(req, res){
	winston.info(req.url);
	console.log('logout.do1:' + JSON.stringify(req.session));
	req.session.destroy(function(err){
		if(!err){
			res.redirect('/login.html');
			console.log('logout.do2:' + JSON.stringify(req.session));
		}
	});
});
app.get('/index.html', function(req, res) {
	winston.info(req.url);
	console.log('index.html :' + JSON.stringify(req.session));
	if (req.session.user) {
		// res.redirect('/index.html');
		fs.readFile('./public/index.html', function(err, data) {
			if (err) {
				res.writeHead(404, {
					'Content-Type' : 'text/html'
				});
				res.end('<h1>404, Not Found</h1>');
			} else {
				// res.writeHead(200, {'Content-Type':'text/html'});
				res.end(data);
			}
		});
	} else {
		res.redirect('/login.html');
	}
});
app.get('/api/card_read.do', function(req, res){
	winston.info(req.url);
	serial.write('{RR}');
	res.send({status:0, msg:'ok'});
});
app.use(express.static(__dirname + '/public'));
app.get('/api/cmd.do', function(req, res) {
	winston.info(req.url);
	if (req.session.user) {
		console.log('session:' + JSON.stringify(req.session.user));
		console.log(req.ip + ":" + req.url);

		var key = req.param('key');
		var value = req.param('value');
		var resmsg = {
			status : 0,
			msg : ''
		};
		console.log("cmd:" + key + "," + value + ".");
		winston.info("cmd:" + key + "," + value + ".");
		if (key === 'MODE') {
			if (value === 'normal') {
				turnOnIR(false)
				sw_alram.writeSync(0);
				arduinoMode('normal');
				mode = 'NOR';
				res.send(resmsg);
			} else {
				if (status.door) {
					res.send({
						status : -1,
						msg : '현관문이 열려 있어서 방범설정을 할 수 없습니다.'
					});
					return;
				} else {
					if (value === 'sleep') {
						turnOnIR(true, function() {
							arduinoMode('sec');
							mode = 'SLP';
							res.send(resmsg);
						}, function() {
							res.send({
								status : -1,
								msg : '거실창 센서에 장애물이 감지되어 방범설정을 할 수 없습니다.'
							});
						});
					} else if (value === 'out') {
						if (status.act) {
							res.send({
								status : -1,
								msg : '실내에 움직임이 있어 외출방범을 설정할 수 없습니다.'
							});
							return;
						} else {
							turnOnIR(true, function() {
								arduinoMode('sec');
								mode = 'OUT';
							}, function() {
								res.send({
									status : -1,
									msg : '거실창 센서에 장애물이 감지되어 방범설정을 할 수 없습니다.'
								});
								turnOnIR(false);
							});
						}
					}

				}
			}
		}else if(key === 'init'){
			if(req.session.user){
				res.send({status : 0, user: req.session.user, mode : mode });
			}else{
				res.send({status: -1, msg: 'no login.'});
			}
		}
	}else{// no session
		res.send({status :'-1', msg:'사용할 권한이 없습니다.'});
	}
});

function changeMode(m){
	if(m === 'NOR'){
		turnOnIR(false)
		sw_alram.writeSync(0);
		arduinoMode('normal');
		mode = 'NOR';
		if (io.sockets.sockets.length > 0 ) {
			io.emit('mode', mode);
			winston.info('emit: mode,' + mode );
		}
	}
}

function turnOnIR(sw, s_callback, e_callback) {
	if (sw) {
		sw_ir.write(1, function(err) {
			console.log('ir turn on cb');
			if (err) {
				console.log('ir turn on err');
			}
			ir_just_on = true;
			var state = sensor_ir.readSync(); // 장애물이 있을때 켜고 끄고 다시 켜면 watch를
												// 통해서 state값이 안들어와서
			console.log('ir(sync):' + state);
			if (ir_just_on && state === 1) {
				status.ir = 9;
				checkStatus();
			}
			sensor_ir.watch(function(err, state) {
				console.log('ir :' + state);
				if (err) {
					console.log('err on ir:' + err);
				} else {
					if (ir_just_on && state === 1) {
						status.ir = 9;
					} else {
						if (ir_just_on) {
							ir_just_on = false;
							status.ir = state;
						}
						status.ir = state;
					}
					checkStatus();
				}
			});
			setTimeout(function() {
				if (ir_just_on && status.ir === 9) {
					if (e_callback) {
						e_callback();
					}
				} else {
					if (s_callback) {
						s_callback();
					}
				}
			}, 3000);
		});
	} else {

		sw_ir.writeSync(0);
		sensor_ir.unwatchAll();
		status.ir = -1;
		reportStatus(true);
	}
}

function arduinoMode(mode) {
	if (mode === "normal") {
		serial.write('{M0}');
	} else {
		serial.write('{M1}');
	}
	winston.info('arduion send: ' + mode);
}

serial.open(function(error) {
	if (error) {
		winston.error("serial open error :" + error);
		return;
	}
	serial.on('data', function(data) {
		winston.info('seirla RCV:' + data);
		try {
			if (/^{(.+)}$/.test(data)) {

				if (data.charAt(1) == 'C') { // card read
					var key = data.replace(/(^{.)|(}$)/g, "");
					var flag = false;
					for (var i = 0; i < cardKeys.length; i++) {
						winston.info(i + ":" + cardKeys[i] + "," + key);
						if (cardKeys[i] == key) {//card key correct,
							if(mode !== 'NOR'){  //change mode to NORmal
								changeMode('NOR');
							}
							sw_door_lock.writeSync(1);
							serial.write('{D1}'); // open door
							flag = true;
							winston.info(key + ',' + flag);
							setTimeout(function() {
								sw_door_lock.writeSync(0);
							}, 5000);
							break;
						}
					}
					if (!flag)	serial.write('{D0}');//card key incorrect, don't open door
				}else if(data.charAt(1) == 'R'){// card reg
					var key = data.replace(/(^{.)|(}$)/g, "");
					if(key.indexOf('ERR') == 0){
						io.emit('card', {status:-1, msg:key});
					}else{
						io.emit('card', {status:0, uuid:key});
					}
				}
			}
		} catch (e) {
			winston.error(e);
		}
	});
});

io.on('connect', function(socket) {
	winston.info('socket connect..: ' + io.sockets.sockets.length);
	reportStatus(true);
});

function reportStatus(force) {
	winston.info("report:" + JSON.stringify(status));
	if (force) {
		if (io.sockets.sockets.length > 0) {
			for (k in status) {
				lastStatus[k] = status[k];
			}

			io.emit('monitor', status);
			winston.info('emit('+io.sockets.sockets.length+') monitor(force):' + JSON.stringify(status));
		}
	} else {
		var diff = {};
		var diffCnt = 0;
		for (k in status) {
			if (status[k] != lastStatus[k]) {
				diff[k] = status[k];
				diffCnt++;
				lastStatus[k] = status[k];
			}
		}
		if (io.sockets.sockets.length > 0 && diffCnt > 0) {
			io.emit('monitor', diff);
			winston.info('emit('+io.sockets.sockets.length+') monitor:' + JSON.stringify(diff));
		}
	}
}
function notifyAlram(msg) {
	sw_alram.writeSync(1);
	if (io.sockets.sockets.length > 0) {
		io.emit('alarm', msg);
		winston.info('emit alarm:' + JSON.stringify(msg));
	}
	var message = new gcm.Message({
		collapseKey : 'PushProvider',
		delayWhileIdel :true,
		timeToLive :3,
		data:{
			title : 'SecHome, 경보!!!',
			message : msg.msg,
			key1 : 'Hello SecomPi',
			key2 : 'Push message.'
		}
	});

	sender.send(message, regid, 4, function(err, result){
		winston.debug(result);
	});
}

server.listen(3000, function() {
	console.log('server running on port 3000...');
});
