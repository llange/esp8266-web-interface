/*
 * This file is part of the esp8266 web interface
 *
 * Copyright (C) 2018 Johannes Huebner <dev@johanneshuebner.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

var chart;
var items = {};
var stop;
var imgid = 0;
var subscription;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function checkSubscribedParameterSet()
{
	if (subscription)
	{
		checkToken(subscription.token, 'Checking your parameter subscription ' + subscription.token, false);
	}
}

/* If a valid token is entered, the belonging dataset is downloaded
 * and applied to the inverter. Token and timestamp are saved to ESP filesystem
 * Token example 5f4d8fa6-b6a4-4f87-9a28-4363bdac5dc9 */
function checkToken(token, message, forceUpdate)
{
	var expr = /^[0-9a-f]{8}\-[0-9a-f]{4}\-[0-9a-f]{4}\-[0-9a-f]{4}\-[0-9a-f]{12}$/i;
	
	if (expr.test(token))
	{
		var xmlhttp=new XMLHttpRequest();
		var req = "https://openinverter.org/parameters/api.php?token=" + token;

		document.getElementById("message").innerHTML = message + "\r\n";
		document.getElementById("parameters_token").value = token;

		xmlhttp.onload = function() 
		{
			var params = JSON.parse(this.responseText);
			var timestamp = params.timestamp;
			
			delete params['timestamp'];			
			document.getElementById("token").value = token;
			
			if (subscription && subscription.timestamp == timestamp && !forceUpdate)
			{
				document.getElementById("message").innerHTML += "Parameters up to date\r\n";
			}
			else if (forceUpdate || confirm("Parameter set updated, apply?"))
			{
				document.getElementById("message").innerHTML += "Applying new parameter set from " + timestamp + "\r\n";

				inverter.setParam(params, 0);
				
				var uploadRequest = new XMLHttpRequest();
				var formData = new FormData();
				var subs = "subscription = { 'timestamp': '" + timestamp + "', 'token': '" + token + "' };";
				var blob = new Blob([subs], { type: "text/javascript"});
				formData.append("file", blob, "subscription.js");
				uploadRequest.open("POST", "/edit");
				uploadRequest.send(formData);
			}
		};
		
		xmlhttp.onerror = function()
		{
			alert("error");
		};

		xmlhttp.open("GET", req, true);
		xmlhttp.send();
	}
	else
	{
		var uploadRequest = new XMLHttpRequest();
		var formData = new FormData();
		var subs = "subscription = false;";
		var blob = new Blob([subs], { type: "text/javascript"});
		formData.append("file", blob, "subscription.js");
		uploadRequest.open("POST", "/edit");
		uploadRequest.send(formData);
	}
}




/** @brief send arbitrary command to inverter and print result
 * @param cmd command string to be sent */
function sendCmd(cmd)
{
	inverter.sendCmd(cmd, function(reply)
	{
		document.getElementById("message").innerHTML = reply;
	});
}

/** @brief uploads file to web server, if bin-file uploaded, starts a firmware upgrade */
function uploadFile() 
{
	var xmlhttp = new XMLHttpRequest();
	var form = document.getElementById('uploadform');
	
	if (form.getFormData)
		var fd = form.getFormData();
	else
		var fd = new FormData(form);
	var file = document.getElementById('updatefile').files[0].name;

	xmlhttp.onload = function() 
	{
		if (file.endsWith(".bin"))
		{
			runUpdate(-1, "/" + file);
		}
		document.getElementById("bar").innerHTML = "<p>Upload complete</p>";
		setTimeout(function() { document.getElementById("bar").innerHTML = "" }, 5000);
	}

	xmlhttp.open("POST", "/edit");
	xmlhttp.send(fd);
}

/** @brief uploads file to web server, Flash using Serial-Wire-Debug. Start address bootloader = 0x08000000, firmware = 0x08001000*/
function uploadSWDFile() 
{
	var xmlhttp = new XMLHttpRequest();
	var form = document.getElementById('swdform');
	
	if (form.getFormData)
		var fd = form.getFormData();
	else
		var fd = new FormData(form);
	var file = document.getElementById('swdfile').files[0];

	xmlhttp.onload = function()
	{
		var xhr = new XMLHttpRequest();
		xhr.seenBytes = 0;
		xhr.seenTotalPages = 0;
		xhr.onreadystatechange = function() {
		  if(xhr.readyState == 3) {
		    var data = xhr.response.substr(xhr.seenBytes);

		    if(data.indexOf("Error") != -1) {
		    	document.getElementById("swdbar").style.width = "100%";
				document.getElementById("swdbar").innerHTML = "<p>" + data + "</p>";
		    }else{
			    var s = data.split('\n');
				xhr.seenTotalPages += (s.length - 1) * 16;
				//console.log("pages: " + s.length + " Size: " + ((s.length -1) * 16));

			    var progress = Math.round(100 * xhr.seenTotalPages / file.size);
			    document.getElementById("swdbar").style.width = progress + "%";
			    document.getElementById("swdbar").innerHTML = "<p>" +  progress + "%</p>";
				
			    xhr.seenBytes = xhr.responseText.length;
			}
		  }
		};
		if (file.name.endsWith('loader.bin'))
		{
			xhr.open('GET', '/swd/mem/flash?bootloader&file=' + file.name, true);
		}else{
			xhr.open('GET', '/swd/mem/flash?flash&file=' + file.name, true);
		}
    	xhr.send();
	}
	xmlhttp.open("POST", "/edit");
	xmlhttp.send(fd);
}

/** @brief Runs a step of a firmware upgrade
 * Step -1 is resetting controller
 * Steps i=0..n send page i
 * @param step step to execute
 * @param file file path of upgrade image on server */
function runUpdate(step,file)
{
	var xmlhttp=new XMLHttpRequest();
	xmlhttp.onload = function() 
	{
		step++;
		var result = JSON.parse(this.responseText);
		var totalPages = result.pages;
		var progress = Math.round(100 * step / totalPages);
		document.getElementById("bar").style.width = progress + "%";
		document.getElementById("bar").innerHTML = "<p>" +  progress + "%</p>";
		if (step < totalPages)
			runUpdate(step, file);
		else
			document.getElementById("bar").innerHTML = "<p>Update Done!</p>";
	}
	xmlhttp.open("GET", "/fwupdate?step=" + step + "&file=" + file);
	xmlhttp.send();
}
