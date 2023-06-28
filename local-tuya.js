const TuyaDev = require('tuyapi');

module.exports = function(RED) {

	function TuyaNode(config) {
		RED.nodes.createNode(this,config);
		let node = this;
		let autoReconnect = true;
		this.name = config.name;
		this.Id = config.devId;
		this.Key = config.devKey;
		this.Ip = config.devIp;
		this.version = config.protocolVer;
		let dev_info = {name: config.name, ip: config.Ip, id: config.Id};
		let tuyaDevice;
		let tuyaload = true;
		node.status({fill:"grey",shape:"dot",text: "Standby"});
		let everconnected=false;
		let autoRetry=null;
		let retrysec=1;
		let retrytimer=null;
		let connTime=Date.now();
		let lastError = "";
		let v=0;
		let retryReset=function(){retrysec=5;};
		let connectToDevice=function() {
			if(everconnected && tuyaDevice.isConnected()){
				v=new Date().toLocaleString(); 
				node.status({fill:"green",shape:"dot",text: node.Ip + " @ " + v});
				return;
			}
			tuyaDevice.find(/*{'options': {'timeout':10}}*/).then( () => {
				node.status({fill:"yellow",shape:"dot",text:"connecting"});
				autoReconnect = true;
				everconnected=true;
				tuyaDevice.connect().then( () => {
				}, (reason) => {
					try{clearTimeout(autoRetry);} catch(e) {}
					autoRetry = setTimeout(connectToDevice, (retrysec*1000));
					node.send([null,{status: null, payload: reason, data: dev_info}]);
					reason=JSON.stringify(reason);
					node.status({fill:"red",shape:"ring",text:"Failed: " + reason});
					if(reason != "{}" && reason != lastError){
						lastError = reason;
						if(reason.indexOf("ENETUNREACH")<0){
							node.warn("dc: " + dev_info.name + " " + reason);
						}else{node.warn(reason);}
					}
				});
			});
		};

		let disconnectDevice=function(deleted){
			autoReconnect = deleted ? false : true;
			try{tuyaDevice.disconnect();} catch(e) {}
		};


		node.on('input', function(msg) {
			if(msg && msg.hasOwnProperty('ip') && msg.ip.length>7){
				this.Ip = msg.ip;
				if(everconnected){
					node.log("ip connection req: " + this.name + ( (tuyaDevice.isConnected())? ' con': ' ncon' )  );
					if(tuyaDevice.isConnected()){
						return connectToDevice();
					}else{
						disconnectDevice(true);tuyaDevice=null;tuyaload=true;
					}
				}
			}

			if(tuyaload ){ 
				if(this.Ip == ""){
					node.warn("Tuya Ip missing for "+ this.name);
					node.status({fill:"blue",shape:"dot",text: "Ip Missing"});
					return;
				}
				tuyaload = false;
				dev_info.ip=this.Ip;
				tuyaDevice = new TuyaDev({ 
					id: this.Id, 
					key: this.Key, 
					ip: this.Ip, 
					version: this.version, 
					nullPayloadOnJSONError: false,
					issueGetOnConnect: false, 
					issueRefreshOnConnect: false,
					issueRefreshOnPing: false,
				});
					
				tuyaDevice.on('disconnected', () => {
					v=Date.now() - connTime;
					let day = v / 8.64e7 | 0;
					let hrs = (v % 8.64e7) / 3.6e6 | 0;
					let mins = Math.round((v % 3.6e6) / 6e4);
					let sec = Math.floor((v / 1000) % 60);
					
					day = (day>0) ? ( day + ' Days ' ) : '';
					day += hrs.toString().padStart(2, '0') + ':' + mins.toString().padStart(2, '0') + ':' + sec.toString().padStart(2, '0');
					
					try{clearTimeout(autoRetry);} catch(e) {}
					if (autoReconnect) {
						retrysec++;
						retrysec = Math.min(15, retrysec);
						autoRetry = setTimeout(connectToDevice, (retrysec*1000));
						
						node.log("DC: " + this.name + " after "+day+", retry in " + retrysec + "s");
					}else{
						node.log("DC: " + this.name + " after "+day+", retry disabled");
						
					}
					
					v=new Date().toLocaleString();
					node.status({fill:"red",shape:"ring",text:"Disconnected @ " + v});
					node.send([null,{status: "offline", payload: "Disconnected", data: dev_info}]);
				});

				tuyaDevice.on('connected', () => {
					node.log("Connected: " + this.name + " " + retrysec + "s" );
					v=new Date().toLocaleString();
					node.status({fill:"green",shape:"dot",text: this.Ip + " @ " + v});
					try{clearTimeout(autoRetry);} catch(e) {}
					try{clearTimeout(retrytimer);} catch(e) {}
					retrytimer=setTimeout(retryReset, 120000);
					autoReconnect = true;
					connTime=Date.now();
					node.send([null, {status: "online", payload: "Connected", data: dev_info}]);
				});

				tuyaDevice.on('error', error => {
					let jerror=JSON.stringify(error);
					if(jerror && jerror != "{}" && jerror != lastError){
						lastError = jerror;
						node.warn(jerror);
						node.send([null, {status: null, payload: error, data:dev_info}]);
					}
					node.status({fill:"green",shape:"ring",text:"error: " + jerror});
				});

				tuyaDevice.on('data', (data, CommandType) => {
					node.send([{data: dev_info, payload: data, CommandType: CommandType}, null]); 
				});

				tuyaDevice.on('dp-refresh', (data) => {
					node.send([{data: dev_info, payload: data, CommandType: 18}, null]);
				});

				connectToDevice();
				return;
			}
			if(everconnected && !tuyaDevice.isConnected()){disconnectDevice(true);connectToDevice();return;}
			if(!msg){
				return;
			}
			if (msg.hasOwnProperty('action')) {
				if(msg.action == "connect"){
					connectToDevice();
				}else if(msg.action == "disconnect"){
					node.warn("manual disconnect of "+this.name)
					disconnectDevice(true);
					return;
				}
				
			}
			if ( msg.hasOwnProperty('request') ) {
				tuyaDevice.get({"schema":true});
			}else if ( msg.hasOwnProperty('payload') ) {
				tuyaDevice.set({
					multiple:true,
					data: msg.payload
				});
			}else{
				node.warn(JSON.stringify(msg));
			}
		});

		node.on('close', function(removed, done) {
			autoReconnect = false; tuyaload = false;
			try{clearTimeout(autoRetry);} catch(e) {}
			if(everconnected){disconnectDevice(true); everconnected=false;}
			done();
		});
	}
	RED.nodes.registerType("local-tuya",TuyaNode);
}

