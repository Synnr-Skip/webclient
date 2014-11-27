var IMAGE_PLACEHOLDER = staticpath + "/images/img_loader@2x.png";

(function(window, asmCrypto) {

var pubkey = ab_to_str(asmCrypto.base64_to_bytes('gVbVNtVJf210qJLe+GxWX8w9mC+WPnTPiUDjBCv9tr4='))

function verify_cms_content(content, signature)
{
	var hash = asmCrypto.SHA256.hex(content)
	signature = ab_to_str(signature)

	try {
		return jodid25519.eddsa.verify(signature, hash, pubkey);
	} catch (e) {
		/* rubbish data, invalid anyways */
		return false;
	}
}

function process_cms_response(bytes, next, as, id)
{
	var viewer = new Uint8Array(bytes)

	var signature = bytes.slice(3, 67); // 64 bytes, signature
	var version = viewer[0];
	var mime = viewer[1];
	var label = ab_to_str(bytes.slice(67, viewer[2]+67));
	var content = bytes.slice(viewer[2]+67)

	delete bytes;

	if (as == "download") mime = 0;

	if (verify_cms_content(content, signature)) {
		switch (mime) {
		case 3: // html
			content = ab_to_str(content)
			 next(false, { html: content, mime: mime})
			 return loaded(id);
			break;

		case 1:
			var blob = new Blob([content]);
			content = window.URL.createObjectURL(blob);
			next(false, { url: content, mime: mime})
			return loaded(id);

		case 2:
			try {
				content = JSON.parse(ab_to_str(content))
			} catch (e) {
				/* invalid json, weird case */
				return next(true, {signature: false});
			}
			next(false, { object: content, mime: mime})
			return loaded(id);

		default:
			var io = new MemoryIO("temp", {});
			io.begin = function() {};
			io.setCredentials("", content.byteLength, "", [], []);
			io.write(content, 0, function() {
				io.download(label, "");
				next(false, {});
				return loaded(id);
			});
			break;
		}
	} else {
		next(true, {error: 'Invalid signature', signature: true} );
	}
}

var assets = {}, cmsToId = null
var booting = false;

var is_img

/**
 *	Rewrite links. Basically this links 
 *  shouldn't trigger the `CMS.get` and force
 *  a download
 */
function dl_placeholder(str, sep, rid, id) {
	return "'javascript:void(0)' data-cms-dl='"+id+"'"
}

/**
 *	Images placeholder. Replace *all* the images 
 *	with a placeholder until the image is fully loaded from 
 *  the BLOB server
 */
function img_placeholder(str, sep, rid, id) {
	is_img = true;
	return "'" + IMAGE_PLACEHOLDER + "' data-img='loading_" +  id + "'" 
}

function cmsObjectToId(name)
{
	var q = getxhr();
	if (d) console.error("CMS: loading " + name)
	q.onload = function() {
		if (name == '_all') {
			cmsToId = JSON.parse(ab_to_str(q.response));
		} else {
			cmsToId[name] = ab_to_str(q.response).split(".")
		}
		q = null;
		if (name != '_all') doRequest(name);
	}
	q.onerror = function() {
		Later(function() {
			cmsObjectToId(name);
		})
		q = null;
	};
	q.responseType = 'arraybuffer';
	q.open("GET", (localStorage.cms || "//cms.mega.nz/") + name);
	q.send();
}

/**
 *	Internal function to communicate with the BLOB server.
 *	
 *	It makes sure that optimize requests (makes sure we never
 *	ask things twice). This is the right place to 
 *	cache (perhaps towards localStorage).
 */
var fetching = {};
function doRequest(id) {
	if (d) console.error("CMS fetch element", id)
	if (cmsToId === null) {
		if (!booting) {
			booting = true;
			cmsObjectToId('_all');
		}
		return Later(function() {
			doRequest(id);
		});
	}
	if (!cmsToId[id]) {
		return cmsObjectToId(id)
	}
	_cms_request(cmsToId[id], function(blob) {
		for (var i in fetching[id]) {
			process_cms_response(blob, fetching[id][i][0], fetching[id][i][0], id);
		}
		delete fetching[id];
	});
}

var _listeners = {};

function loaded(id)
{
	if (_listeners[id]) {
		for (var i in _listeners[id]) {
			_listeners[id][i]();
		}
	}
	CMS.attachEvents();
}

function _concat_arraybuf(arr)
{
	var len = arr.reduce(function(prev, e) {
		return prev+e.byteLength
	}, 0);
	var buffer = new Uint8Array(len)
	var offset = 0
	for (var i in arr) {
		buffer.set(new Uint8Array(arr[i]), offset)
		offset += arr[i].byteLength
	}
	return buffer.buffer
}

function _cms_request(ids, next)
{
	if (d) console.error("CMS: request", ids)
	var args = []
		, q  = []
		, done = 0
	for (var i in ids) {
		args.push({fa:i+":1*" + ids[i], k:i, plaintext: true})
		q[i] = null
	}

	api_getfileattr(args, 1, function(ctx, id, bytes)
	{
		if (d) console.error("Got response", id, bytes.byteLength, ctx)
		
		q[id] = bytes
		if (++done == q.length) {
			next(_concat_arraybuf(q))
			q = undefined
		}
	});
}

var curType;
var curCallback;

var CMS = {
	watch: function(type, callback)
	{
		curType = type;
		curCallback = callback;
	},

	reRender: function(type, nodeId)
	{
		// If cmsToId is NULL it means we didn't open
		// *any* CMS content so we should ignore this
		// update, we will get the newest version always
		// when we need it (the first time)
		if (!(cmsToId instanceof Object)) return;

		cmsToId[type] = nodeId;
		if (type == curType) {
			curCallback(nodeId);
		}
	},

	attachEvents: function() {
		$('*[data-cms-dl],.cms-asset-download').rebind('click', function(e) {
			var $this = $(this)
				, target = $this.data('id') || $this.data('cms-dl');
			if (!target) return;

			e.preventDefault();

			loadingDialog.show();
			CMS.get(target, function() {
				loadingDialog.hide();
			}, 'download');

			return false;
		});
	},

	img : function(id) {
		if (!assets[id]) {
			this.get(id, function(err, obj) {
				$('*[data-img=loading_' + id + ']').attr({'id': '', 'src': obj.url})
				assets[id] = obj.url;
			});
		}
		return assets[id] ? assets[id] : IMAGE_PLACEHOLDER;
	},
	get: function(id, next, as) {
		if (typeof fetching[id] == "undefined") {
			doRequest(id);
			fetching[id] = [];
		}
		fetching[id].push([next, as]);
	},

	on: function(id, callback)
	{
		if (!_listeners[id]) {
			_listeners[id] = [];
		}
		_listeners[id].push(callback);
	},

	imgLoader: function(html, id) {
		if (!assets[id]) {
			is_img = false;
			// replace images
			html = html.replace(new RegExp('([\'"])(i:(' + id + '))([\'"])', 'g'), img_placeholder);
			// replace download links
			html = html.replace(new RegExp('([\'"])(d:(' + id + '))([\'"])', 'g'), dl_placeholder);
		
			if (is_img) {
				this.get(id);
			}
		} else {
			html = html.replace(IMAGE_PLACEHOLDER + "' data-img='loading_" + id, assets[id], 'g');
		}
		return html;
	}
};

/* Make it public */
window.CMS = CMS;

})(this, asmCrypto)

CMS.on('corporate', function()
{
	$('.new-left-menu-link').rebind('click', function() {
		var $this = $(this)
		$('.new-right-content-block').addClass('hidden');
		$('.new-right-content-block.' + $this.attr('id')).removeClass('hidden');
		$('.new-left-menu-link').removeClass('active');
		$this.addClass('active');			
	});
	$('.new-left-menu-link:first').trigger('click');
});