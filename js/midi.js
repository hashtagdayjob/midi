(function(window) {
	if (!window.console || !window.console.log) { return; }

	console.log('MIDI 0.6.2');
	console.log('http://github.com/soundio/midi');
	//console.log('MIDI events hub and helper library');
})(this);

(function(window) {
	"use strict";

	var debug = true;

	var assign = Object.assign;
	var Fn     = window.Fn;

	var slice  = Function.prototype.call.bind(Array.prototype.slice);

	var rtype = /^\[object\s([A-Za-z]+)/;

	var empty = [];

	var map = { all: [] };

	var store = [];

	var outputs = [];


	// Utilities

	var noop      = Fn.noop;
	var isDefined = Fn.isDefined;

	function typeOf(object) {
		var type = typeof object;

		return type === 'object' ?
			rtype.exec(Object.prototype.toString.apply(object))[1].toLowerCase() :
			type ;
	}

	function clear(obj) {
		var key;
		for (key in obj) { delete obj[key]; }
	}

	function getListeners(object) {
		if (!object.listeners) {
			Object.defineProperty(object, 'listeners', {
				value: {}
			});
		}

		return object.listeners;
	}


	// Deep get and set for getting and setting nested objects

	function get(object, property) {
		if (arguments.length < 2) {
			return object;
		}

		if (!object[property]) {
			return;
		}

		var args = slice(arguments, 1);

		args[0] = object[property] ;
		return get.apply(this, args);
	}

	function set(object, property, value) {
		if (arguments.length < 4) {
			object[property] = value;
			return value;
		}

		var args = slice(arguments, 1);

		args[0] = object[property] === undefined ? (object[property] = {}) : object[property] ;
		return set.apply(this, args);
	}

	function remove(list, fn) {
		var n = list.length;

		while (n--) {
			if (list[n][0] === fn) {
				list.splice(n, 1);
			}
		}
	}


	function MIDI(query) {
		if (!MIDI.prototype.isPrototypeOf(this)) { return new MIDI(query); }

		Fn.Stream.call(this, function setup(notify) {
			var buffer = [];

			function fn(message, time) {
				buffer.push(arguments);
				notify('push');
			}

			MIDI.on(query, fn);

			return {
				shift: function midi() {
					return buffer.shift();
				}
			};
		});
	}

	//MIDI.prototype = Object.create(Fn.Stream.prototype);

	function triggerList(list, e) {
		var l = list.length;
		var n = -1;
		var fn, args;

		list = list.slice();

		while (++n < l) {
			fn = list[n][0];
			args = list[n][1];
			args[0] = e.data;
			args[1] = e.receivedTime;
			args[2] = e.target;
			fn.apply(MIDI, args);
		}
	}

	function triggerTree(object, array, n, e) {
		var prop = array[n];
		var obj = object[prop];

		if (obj) {
			++n;

			if (n < array.length) {
				triggerTree(obj, array, n, e);
			}
			else if (obj.length) {
				triggerList(obj, e);
			}
		}

		if (object.all) {
			triggerList(object.all, e);
		}
	}

	function trigger(object, e) {
		triggerTree(getListeners(object), e.data, 0, e);
	}

	function createData(channel, message, data1, data2) {
		var number = MIDI.typeToNumber(channel, message);
		var data = typeof data1 === 'string' ?
		    	MIDI.noteToNumber(data1) :
		    	data1 ;

		return data1 ? data2 ? [number, data, data2] : [number, data] : [number] ;
	}

	function createDatas(channel, type, data1, data2) {
		var types = MIDI.types;
		var datas = [];
		var regexp, n;

		if (!type) {
			n = types.length;
			while (n--) {
				type = types[n];
				datas.push.apply(datas, createDatas(channel, type, data1, data2));
			}
			return datas;
		}

		if (typeOf(type) === 'regexp') {
			regexp = type;
			n = types.length;
			while (n--) {
				type = types[n];
				if (regexp.test(type)) {
					datas.push.apply(datas, createDatas(channel, type, data1, data2));
				}
			}

			return datas;
		}

		if (channel && channel !== 'all') {
			datas.push(createData(channel, type, data1, data2));
			return datas;
		}

		var ch = 16;
		var array = createData(1, type, data1, data2);
		var data;

		while (ch--) {
			data = array.slice();
			data[0] += ch;
			datas.push(data);
		}

		return datas;
	}

	function createQueries(query) {
		var queries;

		if (query.message === 'note') {
			var noteons  = createDatas(query.channel, 'noteon', query.data1, query.data2);
			var noteoffs = createDatas(query.channel, 'noteoff', query.data1, query.data2);

			queries = noteons.concat(noteoffs);
		}
		else {
			queries = createDatas(query.channel, query.message, query.data1, query.data2);
		}

		return queries;
	}

	function on(map, query, fn, args) {
		var list = query.length === 0 ?
		    	get(map, 'all') || set(map, 'all', []) :
		    query.length === 1 ?
		    	get(map, query[0], 'all') || set(map, query[0], 'all', []) :
		    query.length === 2 ?
		    	get(map, query[0], query[1], 'all') || set(map, query[0], query[1], 'all', []) :
		    	get(map, query[0], query[1], query[2]) || set(map, query[0], query[1], query[2], []) ;

		list.push([fn, args]);
	}

	function offTree(object, fn) {
		var key;

		// Remove the matching function from each array in object
		for (key in object) {
			if (object[key].length) {
				remove(object[key], fn);
			}
			else {
				offTree(object[key], fn);
			}
		}
	}

	function off(map, query, fn) {
		var args = [map];

		args.push.apply(args, query);

		if (!fn) {
			// Remove the object by setting it to undefined (undefined is
			// implied here, we're not passing it to set() explicitly as the
			// last value in args).
			set.apply(this, args);
			return;
		}

		var object = get.apply(this, args);
		var key;

		if (!object) { return; }

		offTree(object, fn);
	}

	function send(port, data) {
		if (port) {
			port.send(data, 0);
		}
	}

	assign(MIDI, {
		trigger: function(data) {
			var e = {
			    	data: data,
			    	receivedTime: +new Date()
			    };

			trigger(this, e);
		},

		on: function(query, fn) {
			var type = typeof query;
			var map = getListeners(this);
			var args = [];
			var queries;

			if (type === 'object' && isDefined(query.length)) {
				queries = createQueries(query);
				args.length = 1;
				args.push.apply(args, arguments);

				while (query = queries.pop()) {
					on(map, query, fn, args);
				}

				return this;
			}

			if (type === 'function') {
				fn = query;
				query = empty;
				args.length = 2;
			}
			else {
				args.length = 1;
			}

			args.push.apply(args, arguments);

			on(map, query, fn, args);
			return this;
		},

		once: function(query, fn) {
			var type = typeOf(query);

			if (type === 'function') {
				fn = query;
				query = empty;
			}

			return this
			.on(query, fn)
			.on(query, function handleOnce() {
				this.off(query, fn);
				this.off(handleOnce);
			});
		},

		off: function(query, fn) {
			var type = typeOf(query);
			var map = getListeners(this);
			var queries;

			if (type === 'object') {
				queries = createQueries(query);

				while (query = queries.pop()) {
					off(map, query, fn);
				}

				return this;
			}

			if (!fn && type === 'function') {
				fn = query;
				query = empty;
			}
			else if (!query) {
				query = empty;
			}

			off(map, query, fn);
			return this;
		},

		// Set up MIDI.request as a promise

		request: navigator.requestMIDIAccess ?
			navigator.requestMIDIAccess() :
			Promise.reject("This browser does not support Web MIDI.") ,


		// Set up MIDI to listen to browser MIDI inputs
		// These methods are overidden when output ports become available.

		send: noop,
		output: noop
	});

	function listen(input) {
		// It's suggested here that we need to keep a reference to midi inputs
		// hanging around to avoid garbage collection:
		// https://code.google.com/p/chromium/issues/detail?id=163795#c123
		store.push(input);

		// For some reason .addEventListener does not work with the midimessage
		// event.
		//
		//input.addEventListener('midimessage', function(e) {
		//	trigger(MIDI, e);
		//});

		input.onmidimessage = function(e) {
			trigger(MIDI, e);
		};
	}

	function updateInputs(midi) {
		// As of ~August 2014, inputs and outputs are iterables.

		// This is supposed to work, but it doesn't
		//midi.inputs.values(function(input) {
		//	console.log('MIDI: Input detected:', input.name, input.id);
		//	listen(input);
		//});

		var arr;

		for (arr of midi.inputs) {
			var id = arr[0];
			var input = arr[1];
			console.log('MIDI: Input detected:', input.name, input.id);
			listen(input);
		}
	}

	function createSendFn(outputs, map) {
		return function send(portName, data, time) {
			var port = this.output(portName);

			if (port) {
				port.send(data, time || 0);
			}
			else {
				console.warn('MIDI: .send() output port not found:', port);
			}

			return this;
		};
	}

	function createPortFn(ports) {
		return function getPort(id) {
			var port;

			if (typeof id === 'string') {
				for (port of ports) {
					if (port[1].name === id) { return port[1]; }
				}
			}
			else {
				for (port of ports) {
					if (port[0] === id) { return port[1]; }
				}
			}
		};
	}

	function updateOutputs(midi) {
		var arr;

		if (!MIDI.outputs) { MIDI.outputs = []; }

		MIDI.outputs.length = 0;

		for (arr of midi.outputs) {
			var id = arr[0];
			var output = arr[1];
			console.log('MIDI: Output detected:', output.name, output.id);
			// Store outputs
			MIDI.outputs.push(output);
		}

		MIDI.output = createPortFn(midi.outputs);
		MIDI.send = createSendFn(midi.outputs, outputs);
	}

	function setupPorts(midi) {
		function connect(e) {
			updateInputs(midi);
			updateOutputs(midi);
		}

		// Not sure addEventListener works...
		//midi.addEventListener(midi, 'statechange', connect);
		midi.onstatechange = connect;
		connect();
	}

	MIDI.request
	.then(function(midi) {
		if (debug) { console.groupCollapsed('MIDI'); }
		if (debug) { window.midi = midi; }
		setupPorts(midi);
		if (debug) { console.groupEnd(); }
	})
	.catch(function(error) {
		console.warn('MIDI: Not supported in this browser. Error: ' + error.message);
	});

	window.MIDI = MIDI;
})(window);

(function(window) {
	if (!window.console || !window.console.log) { return; }
	console.log('______________________________');
})(this);
