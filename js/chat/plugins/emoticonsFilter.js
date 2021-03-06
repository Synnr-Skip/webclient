/**
 * Simple Emoticon filter that converts plain-text emoticons to <DIV> with css class names based on the emoticon
 *
 * @param megaChat
 * @returns {EmoticonsFilter}
 * @constructor
 */
var EmoticonsFilter = function(megaChat) {
    var self = this;

    self.emoticonsRegExp = false;
    self.map = {};

    self.emoticonsLoading = megaChat.getEmojiDataSet('emojis')
        .done(function(emojis) {
            self.emojis = emojis;


            var escapedRegExps = [];
            $.each(emojis, function(k, meta) {
                var slug = ":" + meta.n + ":";

                var txt = "(^|\\W?)(" + RegExpEscape(slug) + ")(?=(\\s|$))";

                self.map[meta.n] = meta.u;

                escapedRegExps.push(
                    txt
                );
            });

            var regExpStr = "(" + escapedRegExps.join("|") + ")";
            self.emoticonsRegExp = new RegExp(regExpStr, "gi");
        });


    megaChat.bind("onBeforeRenderMessage", function(e, eventData) {
        self.processMessage(e, eventData);
    });
    megaChat.bind("onBeforeSendMessage", function(e, messageObject) {
        self.processOutgoingMessage(e, messageObject);
    });

    return this;
};

EmoticonsFilter.prototype.processMessage = function(e, eventData) {
    var self = this;

    if (self.emoticonsLoading.state() === 'pending') {
        self.emoticonsLoading.done(function() {
            self.processMessage(e, eventData);
        });
        return;
    }
    // ignore if emoticons are already processed
    if (eventData.message.emoticonsProcessed === true) {
        return;
    }

    // use the HTML version of the message if such exists (the HTML version should be generated by hooks/filters on the
    // client side.
    var textContents;
    if (eventData.message.getContents) {
        textContents = eventData.message.getContents();
    } else {
        textContents = eventData.message.textContents;
    }


    var messageContents = eventData.message.messageHtml ? eventData.message.messageHtml : textContents;

    messageContents = self.processHtmlMessage(messageContents);

    eventData.message.messageHtml = messageContents;
    eventData.message.emoticonsProcessed = true;
};

EmoticonsFilter.prototype.processHtmlMessage = function(messageContents) {
    var self = this;

    if (!messageContents) {
        return; // ignore, maybe its a system message (or composing/paused composing notification)
    }

    // convert legacy :smile: emojis to utf
    messageContents = messageContents.replace(self.emoticonsRegExp, function(match) {
        var foundSlug = $.trim(match.toLowerCase());
        var textSlug = foundSlug;

        if (foundSlug.substr(0, 1) === ":" && foundSlug.substr(-1, 1) === ":") {
            foundSlug = foundSlug.substr(1, foundSlug.length - 2);
        }
        if (!self.map[foundSlug]) {
            foundSlug = ":" + foundSlug + ":";
        }
        var utf = self.map[foundSlug];

        if (utf) {
            if (!utf) {
                return match;
            }
            var filename = twemoji.convert.toCodePoint(utf);

            return utf;
        } else {
            return match;
        }
    });

    // convert any utf emojis to images
    messageContents = twemoji.parse(messageContents, {
        size: 72,
        callback: function(icon, options, variant) {
            return staticpath + 'images/mega/twemojis/2/' + options.size + '/' + icon + options.ext;
        }
    });

    // inject the awesome onerror for twemojis
    messageContents = messageContents.replace(
        'class="emoji"',
        'class="emoji" onerror="twemoji.onerror.apply(this);"'
    );

    // if only one emoji, make it big
    if (
        messageContents.substr(0, 4) === "<img" &&
        messageContents.substr(-1) === ">" &&
        messageContents.indexOf("<img", 1) === -1
    ) {
        messageContents = messageContents.replace(
            'class="emoji"',
            'class="emoji big"'
        );
    }
    return messageContents;
};

EmoticonsFilter.prototype.processOutgoingMessage = function(e, messageObject) {
    var self = this;
    if (self.emoticonsLoading.state() === 'pending') {
        self.emoticonsLoading.done(function() {
            self.processMessage(e, eventData);
        });
        return;
    }

    var contents = messageObject.contents;

    if (!contents) {
        return; // ignore, maybe its a system message (or composing/paused composing notification)
    }

    contents = contents.replace(self.emoticonsRegExp, function(match) {
        var origSlug = $.trim(match.toLowerCase());
        var foundSlug = origSlug;


        if (foundSlug.substr(0, 1) === ":" && foundSlug.substr(-1, 1) === ":") {
            foundSlug = foundSlug.substr(1, foundSlug.length - 2);
        }

        var utf = self.map[foundSlug];

        if (utf) {
            return match.replace(origSlug, utf);
        } else {
            return match;
        }
    });

    messageObject.textContents = messageObject.contents = contents;
};

EmoticonsFilter.prototype.fromUtfToShort = function(s) {
    var self = this;
    var cached = {};
    return s.replace(/[^\x00-\x7F]{1,}/g, function(match, pos) {
        if (cached[match]) {
            return ":" + cached[match] + ":";
        }
        var found = false;
        Object.keys(self.map).forEach(function(slug) {
            var utf = self.map[slug];
            cached[utf] = slug;

            if (!found && utf === match) {
                found = slug;
                return false;
            }
        });

        return found ? (":" + found  + ":") : match;
    });
};
