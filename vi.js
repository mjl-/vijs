"use strict";
// License: MIT, author: mechiel@ueber.net. See LICENSE.MIT.
;
(function () {
	let debug = false; // Toggle with ctrl+d in command mode.
	const lineheight = 20; // Used for scrolling with ctrl-e. todo: figure out heuristic for line height, used for scrolling
	// We don't log with console.log, only through log().
	const log = (...l) => {
		if (debug) {
			console.debug(...l);
		}
	};
	// When accessing clipboard, we first request permission. Surprising the
	// browser isn't doing that automatically (perhaps special behaviour for
	// addons? or probably it does check anyway and this is superfluous). We
	// actually ignore whatever permission we think we got. If we don't have
	// permission, we'll get an error to read/write the clipboard anyway. We just
	// want to ensure the browser asks the user if the browser supports it.
	const clipboardWriteText = async (s) => {
		const w = window;
		!w.browser?.permissions?.request || await w.browser.permissions.request({ permissions: ['clipboardWrite'] });
		if (!window.navigator.clipboard) {
			throw new Error('clipboard not available in insecure context (e.g. plain http)');
		}
		await window.navigator.clipboard.writeText(s);
	};
	const clipboardReadText = async () => {
		const w = window;
		!w.browser?.permissions?.request || await w.browser.permissions.request({ permissions: ['clipboardRead'] });
		if (!window.navigator.clipboard) {
			throw new Error('clipboard not available in insecure context (e.g. plain http)');
		}
		return await window.navigator.clipboard.readText();
	};
	// wrapRepeatLead returns any string of s that should be repeated on the next line when wrapping.
	// The string does not include spaces, it is a word (token on a line) that can be wrapped.
	const wrapRepeatLead = (s) => {
		for (const prefix of ['#', '>', '//']) {
			if (s.startsWith(prefix)) {
				return prefix;
			}
		}
		return '';
	};
	// Wrap text at 78 characters, keep leading spaces or tabs when wrapping, and
	// recognizing lines starting with "- " as enumeration, and starting each next line
	// with a "#" or "> " when the start of the line does.
	const wrap = (s) => {
		// Rather hacky, to be rewritten more properly.
		// We read the input into tokens: a word, space, newline, leading whitespace.
		// Then we generate output tokens, looking back in output and ahead for next tokens
		// to determine if we should skip a space, insert a newline for wrapping, etc.
		const tokens = [];
		let w = '';
		let linestart = true;
		const flush = () => {
			if (!w) {
				return;
			}
			if (linestart) {
				tokens.push(['leadws', w]);
			}
			else {
				tokens.push(['word', w]);
			}
			w = '';
			linestart = false;
		};
		for (const c of s) {
			if (c === '\n') {
				if (linestart && w) {
					w = '';
				}
				flush();
				tokens.push(['newline', '']);
				linestart = true;
			}
			else if (c === ' ' || c === '\t') {
				if (linestart) {
					w += c;
					continue;
				}
				flush();
				const t = tokens[tokens.length - 1];
				if (t[0] === 'word') {
					tokens.push(['space', '']);
				}
			}
			else {
				if (w && linestart) {
					flush();
				}
				linestart = false;
				w += c;
			}
		}
		flush();
		log('tokens in', tokens);
		// Process input tokens into output tokens.
		let linelen = 0;
		let lineleadws = '';
		let moreleadws = ''; // empty, or set to two spaces when first token on line was "-" (enumeration).
		let linehaveinputword = false; // Whether we've seen a word for this input line.
		let lineprefix = ''; // Set to '# ' or '> ' or '// ' when start of line contained that.
		let out = [];
		for (let i = 0; i < tokens.length; i++) {
			// Current, prev and next token and data.
			const [t, c] = tokens[i];
			const [pt] = tokens[i - 1] || ['', ''];
			const [nt, nc] = tokens[i + 1] || ['', ''];
			const [nnt, nnc] = tokens[i + 2] || ['', ''];
			if (t === 'word') {
				if (!linehaveinputword) {
					lineprefix = wrapRepeatLead(c);
					linehaveinputword = true;
				}
				// If it doesn't fit, wrap by starting with new line.
				if (linelen > 0 && linelen + c.length >= 78) {
					out.push(['newline', '\n']);
					// Keep same leading whitespace.
					if (lineleadws || moreleadws) {
						out.push(['leadws', lineleadws + moreleadws]);
					}
					if (lineprefix) {
						out.push(['word', lineprefix]);
					}
					linelen = lineleadws.length + moreleadws.length + lineprefix.length;
				}
				else if (out.length > 0 && out[out.length - 1][0] === 'word') {
					out.push(['space', ' ']);
				}
				if (c === '-' && (out.length === 0 || out[out.length - 1][0] === 'newline' || out.length === 1 && out[out.length - 1][0] === 'leadws' || (out.length > 1 && out[out.length - 1][0] === 'leadws' && out[out.length - 2][0] === 'newline'))) {
					moreleadws = '  ';
				}
				out.push(['word', c]);
				linelen += c.length;
			}
			else if (t === 'space') {
				if (nt !== 'word') {
					continue;
				}
				if (linelen > 0 && linelen + 1 + nc.length < 78) {
					out.push(['space', ' ']);
					out.push(['word', nc]);
					linelen += 1 + nc.length;
					i++;
				}
				else {
					out.push(['newline', '\n']);
					out.push(['leadws', lineleadws + moreleadws]);
					if (lineprefix) {
						out.push(['word', lineprefix]);
					}
					linelen = lineleadws.length + moreleadws.length + lineprefix.length;
				}
			}
			else if (t === 'newline') {
				if (pt && pt !== 'newline' && (nt == 'word' && nc !== '-' || nt === 'leadws' && (nc == lineleadws || nc === lineleadws + moreleadws) && !(nnt === 'word' && nnc === '-'))) {
					// Merge next line into this.
					if (nt === 'leadws') {
						i++;
					}
					continue;
				}
				lineleadws = '';
				moreleadws = '';
				out.push(['newline', '\n']);
				linelen = 0;
				linehaveinputword = false;
				lineprefix = '';
			}
			else if (t === 'leadws') {
				linelen = c.length;
				lineleadws = c;
				moreleadws = '';
				out.push(['leadws', c]);
			}
		}
		log('tokens out', out);
		return out.map(t => t[1]).join('');
	};
	// We keep track of the cursor/selection. Cur is where new text is typed, start
	// is the start of selection. If there is no selection, cur is equal to start.
	// Direction is implied by cur & start.
	class Cursor {
		cur;
		start;
		constructor(cur, start) {
			this.cur = cur;
			this.start = start;
			this.cur = cur;
			this.start = start;
		}
		isForward() {
			return this.cur >= this.start;
		}
		atStart() {
			const o = Math.min(this.cur, this.start);
			return new Cursor(o, o);
		}
		atEnd() {
			const o = Math.max(this.cur, this.start);
			return new Cursor(o, o);
		}
		// As expected by setSelectionRange.
		ordered() {
			const c = this.cur, s = this.start;
			if (c < s) {
				return [c, s, 'backward'];
			}
			return [s, c, 'forward'];
		}
	}
	// We build up multicharacter commands, try to parse them. These errors can
	// happen, some cause us to gather more data, others to clear the command
	// buffer.
	class IncompleteError extends Error {
	}
	class BadNumberError extends Error {
	}
	class BadMotionError extends Error {
	}
	class NoNumberError extends Error {
	}
	class BadCommandError extends Error {
	}
	// Cmd is used for parsing a (partial) command.
	class Cmd {
		s;
		num = 1; // An implied single execution of commands. Overridden if command buffer starts with number.
		numStr = '';
		constructor(s) {
			this.s = s;
			this.s = s; // e.g. just "d", or "2j", etc.
		}
		// Return next char without consuming. Empty when at end.
		peek() {
			if (this.s == '') {
				return '';
			}
			return this.s.charAt(0) || '';
		}
		// Return next character and consume it. Throws error when at end.
		get() {
			if (this.s === '') {
				throw new IncompleteError('incomplete');
			}
			const s = this.s.charAt(0) || '';
			this.s = this.s.substring(1);
			return s;
		}
		// Parse number if present, otherwise stay at 1.
		number() {
			this.numStr = '';
			while (true) {
				const r = this.peek();
				if (!r) {
					break;
				}
				const cp = r.codePointAt(0);
				if (!(cp && cp >= '1'.codePointAt(0) && cp <= '9'.codePointAt(0) || this.numStr !== '' && r === '0')) {
					break;
				}
				this.numStr += r;
				this.get();
			}
			if (!this.numStr) {
				this.num = 1;
				return;
			}
			const v = parseInt(this.numStr);
			if (!v) {
				throw new BadNumberError("bad number");
			}
			this.num = v;
		}
		// Ensure buffer doesn't start with number.
		noNumber() {
			if (this.num !== 1) {
				throw new NoNumberError('no number allowed');
			}
		}
		// Execute fn "num" times (default 1).
		times(fn) {
			for (let i = 0; i < this.num; i++) {
				fn(i);
			}
		}
	}
	// ForwardSource returns characters from a string, moving forward.
	class ForwardSource {
		s;
		o = 0;
		constructor(s) {
			this.s = s;
			this.s = s;
			this.o = 0;
		}
		peek() {
			if (this.o >= this.s.length) {
				return '';
			}
			return this.s.charAt(this.o) || '';
		}
		get() {
			if (this.o >= this.s.length) {
				return '';
			}
			const r = this.s.charAt(this.o);
			this.o++;
			return r;
		}
	}
	// BackwardSource returns characters from a string, moving backwards.
	class BackwardSource {
		s;
		o = 0;
		constructor(s) {
			this.s = s;
			this.s = s;
			this.o = this.s.length;
		}
		peek() {
			if (this.o <= 0) {
				return '';
			}
			return this.s.charAt(this.o - 1);
		}
		get() {
			if (this.o <= 0) {
				return '';
			}
			this.o--;
			return this.s.charAt(this.o);
		}
	}
	// For single characters.
	const isSpace = (c) => c.trim() === ''; // todo: better
	const isPunct = (c) => c !== '_' && /\p{P}/u.test(c);
	// Reader has convenience functions to navigate text (in a Source). Go to
	// start/end of line, etc. Used to implement vi motion commands.
	class Reader {
		start;
		fwd;
		s;
		n; // Number of characters read, excluding peek.
		src;
		constructor(start, fwd, s) {
			this.start = start;
			this.fwd = fwd;
			this.s = s;
			if (fwd) {
				this.src = new ForwardSource(s.substring(start));
			}
			else {
				this.src = new BackwardSource(s.substring(0, start));
			}
			this.start = start;
			this.n = 0;
			this.fwd = fwd;
			this.s = s;
		}
		// Offset, in characters.
		offset() {
			return this.start + (this.fwd ? this.n : -this.n);
		}
		peek() {
			return this.src.peek();
		}
		get() {
			const c = this.src.get();
			if (c) {
				this.n++;
			}
			return c;
		}
		unget(n) {
			if (this.fwd) {
				this.src.o -= n;
			}
			else {
				this.src.o += n;
			}
			this.n -= n;
		}
		clone() {
			return new Reader(this.start, this.fwd, this.s);
		}
		forward() {
			return new Reader(this.offset(), true, this.s);
		}
		backward() {
			return new Reader(this.offset(), false, this.s);
		}
		line(includeNewline) {
			let s = '';
			let eof = false;
			while (true) {
				const c = this.peek();
				if (!c) {
					eof = !s;
					break;
				}
				if (c === '\n') {
					if (includeNewline) {
						this.get();
					}
					break;
				}
				this.get();
				s += c;
			}
			return [s, eof];
		}
		gather(fn) {
			return this.gathernx(1, false, fn);
		}
		gathera(fn) {
			return this.gathernx(1, true, fn);
		}
		gatherna(n, fn) {
			return this.gathernx(n, true, fn);
		}
		gatherx(around, fn) {
			return this.gathernx(1, around, fn);
		}
		gathern(n, fn) {
			return this.gathernx(n, false, fn);
		}
		gathernx(n, around, fn) {
			let chars = [];
			while (true) {
				while (chars.length < n) {
					const c = this.get();
					if (!c) {
						return this;
					}
					chars.push(c);
				}
				if (!fn(chars.join(''))) {
					if (!around) {
						this.unget(chars.length);
					}
					return this;
				}
				chars.shift();
			}
		}
		whitespace(newline) {
			return this.gather(c => (c !== '\n' || newline) && isSpace(c));
		}
		nonwhitespace() {
			return this.gather(c => !isSpace(c));
		}
		whitespacepunct(newline) {
			return this.gather(c => (c !== '\n' || newline) && (isSpace(c) || isPunct(c)));
		}
		nonwhitespacepunct() {
			return this.gather(c => !isSpace(c) && !isPunct(c));
		}
		punctuation() {
			return this.gather(c => isPunct(c));
		}
	}
	// TextHist is an entry in the undo/redo history.
	class TextHist {
		replaced;
		obuf;
		nbuf;
		constructor(replaced, obuf, nbuf) {
			this.replaced = replaced;
			this.obuf = obuf;
			this.nbuf = nbuf;
			this.replaced = replaced; // Range that was replaced (from original).
			this.obuf = obuf; // Original text that was replaced.
			this.nbuf = nbuf; // New text, placed instead of obuf, at c.
		}
	}
	// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions#escaping
	const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
	// Edit tracks vi editing state for a textarea or input element.
	class Edit {
		e;
		// We highlight elements with a box-shadow & outline color, storing the originals
		// to restore when going into insert mode. Firefox normally shows a 2px solid blue
		// outline on the focused element. We override that outline with one matching our
		// box-shadow color.
		origBoxShadow = '';
		origOutline = '';
		mode;
		cursor;
		// Command so far. We try to parse it as a full command each time a key
		// is pressed. Once we handled a command, we clear it to start a new
		// command.
		commandStr = '';
		visualStr = ''; // Like commandStr, but for visual mode.
		// For searching for a single character on same line, with f/F/t/T and ;/,
		charSearch = '';
		charSearchForward = true;
		charSearchBefore = false; // Stop before character.
		// For searching with "/", "?", or next with "*", "#", and "n", "N".
		searchLast = '';
		searchRegexp; // Cached.
		searchReverse = false;
		// For undo/redo.
		history = [];
		future = [];
		histOpen = false;
		lastKnownValue; // For finding changes made during insert mode, when we enter command mode again.
		// For repeat.
		lastCommand = ''; // Empty command with lastCommandText is a basic text insert.
		needLastCommandText = false;
		lastCommandText = ''; // Text inserted as part of last command.
		// For arrows up/down.
		searchHistory = [];
		exHistory = [];
		// handlers bound to this...
		keydown;
		noninsertblur;
		mouseupx;
		tabdown;
		blurx;
		constructor(e) {
			this.e = e;
			this.e = e;
			this.lastKnownValue = e.value;
			this.mode = 'insert';
			this.cursor = new Cursor(0, 0);
			this.keydown = this.key.bind(this);
			this.noninsertblur = (() => this.off(true)).bind(this);
			this.mouseupx = this.mouseup.bind(this);
			this.tabdown = this.tab.bind(this);
			this.blurx = this.insertblur.bind(this);
			log('Edit for elem', e);
		}
		// elemCursor returns a cursor based on current text selection of element.
		elemCursor() {
			let start = this.e.selectionStart || 0;
			let cur = this.e.selectionEnd || 0;
			if (this.e.selectionDirection === 'backward') {
				[start, cur] = [cur, start];
			}
			return new Cursor(cur, start);
		}
		// set mode, and restore/set box-shadow style.
		setMode(mode) {
			if (mode === 'insert') {
				this.mode = mode;
				this.e.style.boxShadow = this.origBoxShadow;
				this.e.style.outline = this.origOutline;
				this.origBoxShadow = '';
				this.origOutline = '';
				return;
			}
			if (this.mode === 'insert') {
				this.origBoxShadow = this.e.style.boxShadow;
				this.origOutline = this.e.style.outline;
			}
			this.mode = mode;
			// Note: firefox adds a 2px blue outline to the focused element. Yellow should be a
			// good contrasting color for the default command mode.
			if (mode === 'command') {
				this.e.style.boxShadow = '0 0 6px 2px #f9bc07'; // yellow
				this.e.style.outline = '2px solid #f9bc07';
			}
			else if (mode === 'visual') {
				this.e.style.boxShadow = '0 0 6px 2px #a8e352'; // green
				this.e.style.outline = '2px solid #a8e352';
			}
			else if (mode === 'visualline') {
				this.e.style.boxShadow = '0 0 6px 2px #ec6e47'; // red
				this.e.style.outline = '2px solid #ec6e47';
			}
		}
		// Enable editing mode, taking control of the element.
		on(mode) {
			this.cursor = this.elemCursor();
			if (mode) {
				this.setMode(mode);
			}
			else if (this.cursor.cur === this.cursor.start) {
				this.setMode('command');
			}
			else {
				this.setMode('visual');
			}
			this.histAfterInsert();
			this.e.addEventListener('keydown', this.keydown);
			this.e.addEventListener('blur', this.noninsertblur);
			this.e.addEventListener('mouseup', this.mouseupx);
			this.e.removeEventListener('keydown', this.tabdown);
			this.e.removeEventListener('blur', this.blurx);
		}
		// Go back to insert mode, giving control back to browser.
		off(blur) {
			log('vi off', this);
			this.mode = 'insert';
			this.histOpen = false;
			this.lastKnownValue = this.e.value;
			this.setMode('insert');
			this.e.removeEventListener('keydown', this.keydown);
			this.e.removeEventListener('blur', this.noninsertblur);
			this.e.removeEventListener('mouseup', this.mouseupx);
			if (blur) {
				return;
			}
			this.e.addEventListener('keydown', this.tabdown);
			this.e.addEventListener('blur', this.blurx);
		}
		// Tab is called when tab is hit in insert mode, but only after command mode has
		// been enabled once. Tab would normally change focus. But we want to be able to
		// insert a tab when editing text in a textarea. So we do it ourselves. This
		// handler is removed on blur. So next time the element is focused, tab will get
		// its default behaviour of changing focus again, until the user has entered
		// command mode. Hitting tab while in command mode results in the default behaviour
		// of changing focus.
		tab(xe) {
			const e = xe;
			if (e.key !== 'Tab' || this.e instanceof HTMLInputElement) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			this.cursor = this.elemCursor();
			this.replace(this.cursor, '\t', false);
			this.setCursor(this.cursor.cur + 1);
		}
		// Blur is registered when changing from command mode to insert mode. When an
		// element is blurred, the special tab-handling behaviour is unregistered.
		insertblur() {
			this.e.removeEventListener('keydown', this.tabdown);
			this.e.removeEventListener('blur', this.blurx);
		}
		// Mouseup is registered while in command/visual mode. If new and non-empty text
		// was selected, the mode is switched to visual. Otherwise it is switched to
		// insert mode.
		mouseup() {
			const a = this.elemCursor().ordered();
			const b = this.cursor.ordered();
			if (a[0] !== a[1] && (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2])) {
				this.cursor = this.elemCursor();
				this.setMode('visual');
				return;
			}
			this.off();
			this.cursor = this.elemCursor();
		}
		// Set a new cursor (no selection) and update the selected range in the DOM element.
		setCursor(index) {
			log('setCursor', index);
			this.cursor.cur = this.cursor.start = index;
			this.e.setSelectionRange(...this.cursor.ordered());
			// todo: scroll to ensure visibility. possibly call focus(), trigger a keypress, set selectionrange (possibly also without selection)
		}
		// Motion tries to execute a vi motion command, returning new cursor.
		motion(cmd, ctrl, br, fr, endLineChar) {
			let nc = new Cursor(this.cursor.cur, this.cursor.start);
			const cur = (r) => {
				nc.cur = r.offset();
				log('motion set cursor', this.cursor, nc);
			};
			const expand = (cr, sr) => {
				// Expand selection while keeping direction.
				nc.cur = cr.offset();
				const start = sr.offset();
				const fwd = nc.cur >= start;
				if (fwd) {
					nc.start = Math.min(nc.start, start);
				}
				else {
					nc.start = Math.max(nc.start, start);
				}
				log('motion expand', this.cursor, nc);
			};
			// For "cw", the word motion is implicit like "iw" for inner word: the last
			// whitespace should not be replaced.
			const implicitInner = endLineChar === 'c';
			let k = cmd.get();
			if (ctrl && cmd.peek() === '') {
				k = 'ctrl-' + k;
			}
			log('trying motion', k, cmd.s, ctrl, this.cursor.cur, br.offset(), fr.offset());
			switch (k) {
				case '0':
					// Start of line.
					br.line(false);
					cur(br);
					break;
				case '$':
					// End of line.
					cmd.noNumber();
					fr.line(this.mode !== 'command');
					cur(fr);
					break;
				case '^':
					{
						// To first non-whitespace character on line.
						br.line(false);
						fr = new Reader(br.offset(), true, this.e.value);
						fr.whitespace(false);
						cur(fr);
						break;
					}
				case '-':
					{
						// Lines up, to first non-whitespace character.
						cmd.times(() => br.line(true));
						br.line(false);
						fr = new Reader(br.offset(), true, this.e.value);
						fr.whitespace(false);
						cur(fr);
						break;
					}
				case '+':
					{
						// Lines down, to first non-whitespace character.
						cmd.times(() => fr.line(true));
						const rr = new Reader(fr.offset(), false, this.e.value);
						rr.line(false);
						fr = new Reader(rr.offset(), true, this.e.value);
						fr.whitespace(false);
						cur(fr);
						break;
					}
				case 'w':
					cmd.times((i) => {
						const o = fr.offset();
						fr.nonwhitespacepunct();
						if (o === fr.offset()) {
							fr.punctuation();
						}
						if (!implicitInner || i < cmd.num - 1) {
							fr.whitespace(true);
						}
					});
					cur(fr);
					break;
				case 'W':
					// word
					cmd.times((i) => {
						fr.nonwhitespace();
						if (!implicitInner || i < cmd.num - 1) {
							fr.whitespace(true);
						}
					});
					cur(fr);
					break;
				case 'b':
					// to begin of (previous) word
					cmd.times(() => {
						const o = br.offset();
						br.whitespace(true);
						br.nonwhitespacepunct();
						if (o === br.offset()) {
							br.nonwhitespace();
						}
					});
					cur(br);
					break;
				case 'B':
					// like 'b', skip interpunction too
					cmd.times(() => {
						br.whitespace(true);
						br.nonwhitespace();
					});
					cur(br);
					break;
				case 'e':
					// to end of (next) word
					cmd.times(() => {
						fr.whitespace(true);
						fr.nonwhitespacepunct();
					});
					cur(fr);
					break;
				case 'E':
					// like 'e', skip interpunction too
					cmd.times(() => {
						fr.whitespace(true);
						fr.nonwhitespace();
					});
					cur(fr);
					break;
				case 'h':
					// left
					cmd.times(() => {
						const c = br.peek();
						if (c && c !== '\n') {
							br.get();
						}
					});
					cur(br);
					break;
				case 'l':
					// right
					cmd.times(() => {
						const c = fr.peek();
						if (c && c !== '\n') {
							fr.get();
						}
					});
					cur(fr);
					break;
				case 'k':
					// up
					{
						const [so, _] = br.line(false);
						cmd.times(() => {
							br.line(true);
							br.line(false);
						});
						br = new Reader(br.offset(), true, this.e.value);
						for (let i = 0; i < so.length; i++) {
							const c = br.peek();
							if (!c || c === '\n') {
								break;
							}
							br.get();
						}
						cur(br);
						break;
					}
				case 'j':
					// down
					{
						const [so, _] = br.line(false);
						cmd.times(() => {
							fr.line(true);
						});
						for (let i = 0; i < so.length; i++) {
							const c = fr.peek();
							if (!c || c === '\n') {
								break;
							}
							fr.get();
						}
						cur(fr);
						break;
					}
				case '(':
					{
						// to start of prev sentence
						// todo: handle words that contain dots better, like "e.g." and "vi.js".
						cmd.times(() => {
							br.get(); // Make progress.
							br.gathern(2, c => c !== '\n\n' && c.charAt(1) !== '.');
							if (br.peek() === '.') {
								br = br.forward().whitespace(true);
							}
						});
						cur(br);
						break;
					}
				case ')':
					{
						// to start of next sentence
						cmd.times(() => {
							fr.get(); // Make progress.
							fr.gathern(2, c => c !== '\n\n' && c.charAt(0) !== '.');
							if (fr.peek() === '.') {
								fr.get();
								fr.whitespace(true);
							}
							else {
								fr.get(); // Skip leading \n.
								fr.gather(c => c === ' ' || c === '\t');
							}
						});
						cur(fr);
						break;
					}
				case 'f':
				case 't':
				case 'F':
				case 'T':
				case ';':
				case ',':
					{
						// character search on same line.
						// 'f' is forward search, 'F' is backward. 't' and 'T' are similar, but 't' stops
						// before the character and 'T' stops after the character. ';' repeats the last
						// search (with same direction), and ',' repeats in the reverse direction.
						if (k !== ';' && k !== ',') {
							this.charSearch = cmd.get();
							this.charSearchForward = k === 'f' || k === 't';
							this.charSearchBefore = k === 't' || k === 'T';
						}
						if (!this.charSearch) {
							break;
						}
						let forward = this.charSearchForward;
						if (k === ',') {
							forward = !forward;
						}
						let rr = forward ? fr : br;
						let nomatch = false;
						cmd.times(() => {
							// Make progress.
							if (rr.peek() !== '\n') {
								rr.get();
							}
							else {
								nomatch = true;
							}
							rr.gatherx(false, c => c !== this.charSearch && c !== '\n');
						});
						if (nomatch) {
							break;
						}
						// Verify there was indeed a match.
						if (rr.peek() !== this.charSearch) {
							break;
						}
						// Beyond character we searched for.
						if (!this.charSearchBefore) {
							rr.get();
						}
						cur(rr);
						break;
					}
				case 'i':
				case 'a':
					{
						// i for inner, excluding surrounding space or special characters
						// a for around, including surround space or special characters
						const around = k === 'a';
						const kk = cmd.get();
						switch (kk) {
							case 'w':
								// word without interpunction
								br.nonwhitespacepunct();
								cmd.times((i) => {
									const o = fr.offset();
									fr.nonwhitespacepunct();
									if (o === fr.offset()) {
										fr.punctuation();
									}
									if (around || i < cmd.num - 1) {
										fr.whitespace(true);
									}
								});
								break;
							case 'W':
								// word with interpunction
								br.nonwhitespace();
								cmd.times((i) => {
									fr.nonwhitespace();
									if (around || i < cmd.num - 1) {
										fr.whitespace(false);
									}
								});
								break;
							case 's':
								// sentence
								br.gathern(2, c => c !== '\n\n' && c.charAt(1) !== '.');
								cmd.times((i) => {
									if (i > 0) {
										fr.get();
									}
									// First of "." or "\n\n"
									fr.gathera(c => c !== '.');
									const fr2 = fr.clone().gatherna(2, c => c !== '\n\n');
									if (fr2.offset() < fr.offset()) {
										fr = fr2;
									}
									if (around || i < cmd.num - 1) {
										fr.whitespace(true);
									}
								});
								break;
							case 'p':
								// paragraph
								br.gathern(2, c => c !== '\n\n');
								br = br.forward().gather(c => c === '\n');
								cmd.times(() => fr.gathernx(2, false, c => c !== '\n\n'));
								while (fr.peek() === '\n') {
									fr.get();
									if (!around) {
										break;
									}
								}
								break;
							case '\'':
								// single quoted string
								br.gatherx(around, c => c !== '\'');
								fr.gatherx(around, c => c !== '\'');
								break;
							case '"':
								// double quoted string
								br.gatherx(around, c => c !== '"');
								fr.gatherx(around, c => c !== '"');
								break;
							case '(':
							case ')':
							case 'b':
								// matching parenthesis
								br.gatherx(around, c => c !== '(');
								fr.gatherx(around, c => c !== ')');
								break;
							case '<':
							case '>':
								// matching <>'s
								br.gatherx(around, c => c !== '<');
								fr.gatherx(around, c => c !== '>');
								break;
							case 't':
								// matching tag, <x>...</x>
								throw new BadMotionError('todo: at and it not yet implemented');
							case 'B':
								// matching accolades
								br.gatherx(around, c => c !== '{');
								fr.gatherx(around, c => c !== '}');
								break;
							default:
								throw new BadMotionError('unknown motion');
						}
						expand(fr, br);
						break;
					}
				case 'G':
					{
						if (cmd.numStr === "") {
							// to eof
							fr = new Reader(this.e.value.length - 1, true, this.e.value);
							cur(fr);
							break;
						}
						// to absolute line number (1 is first)
						fr = new Reader(0, true, this.e.value);
						for (let i = 1; i < cmd.num; i++) {
							const [_, eof] = fr.line(true);
							if (eof) {
								break;
							}
						}
						cur(fr);
						break;
					}
				case '%':
					{
						// to matching struct key
						cmd.noNumber();
						const starts = "{[(<";
						const ends = "}])>";
						const c = fr.peek();
						if (c && starts.includes(c)) {
							fr.get();
							const index = starts.indexOf(c);
							if (this.expandNested(fr, starts[index], ends[index]) > 0) {
								cur(fr);
								break;
							}
						}
						if (c && ends.includes(c)) {
							br.get();
							const index = ends.indexOf(c);
							if (this.expandNested(br, ends[index], starts[index]) > 0) {
								br.get();
								cur(br);
								break;
							}
						}
						throw new BadMotionError('no match');
					}
				case '{':
					// Backwards to empty line.
					cmd.times(() => {
						br.line(false);
						while (true) {
							const o = br.offset();
							br.get();
							br.line(false);
							const c = br.peek();
							if (!c || br.offset() === o - 1) {
								break;
							}
						}
					});
					cur(br);
					break;
				case '}':
					// Forward to empty line.
					cmd.times(() => {
						while (true) {
							fr.get();
							fr.line(true);
							const c = fr.peek();
							if (!c || c === '\n') {
								break;
							}
						}
					});
					cur(fr);
					break;
				default:
					if (k !== endLineChar) {
						throw new BadMotionError('bad motion command');
					}
					br.line(false);
					cmd.times(() => fr.line(true));
					return new Cursor(fr.offset(), br.offset());
			}
			return nc;
		}
		// Match nested characters like "[" and "]", keeping nesting into
		// account. Returns new offset. Used for implementing "%".
		expandNested(r, up, down) {
			let nested = 1;
			while (true) {
				const c = r.peek();
				if (!c) {
					return 0;
				}
				if (c === down) {
					nested--;
				}
				else if (c == up) {
					nested++;
				}
				if (nested == 0) {
					return r.n;
				}
				r.get();
			}
		}
		// Read text at cursor (selection or empty).
		read(c) {
			const [s, e, _] = c.ordered();
			return this.e.value.substring(s, e);
		}
		// ex interprets a single ex command, string s is non-empty.
		// Throws errors when command cannot be handled (e.g. invalid syntax).
		ex(mode, s) {
			// todo: parse range more completely: number offsets/ranges (including negative) for lines, or . (dot) for current line, or $ for last line, with comma as separator in between start and end. for now, we just recognize a few common ranges explicitly and handle visual selection implicitly.
			var number = 0;
			var numberstr = '';
			const parseNumber = () => {
				let x = '';
				while (s !== '' && s.charAt(0) >= '0' && s.charAt(0) <= '9') {
					x += s.charAt(0);
					s = s.substring(1);
				}
				if (!x) {
					return false;
				}
				number = parseInt(x);
				numberstr = x;
				return true;
			};
			let start = 0;
			let end = 0;
			if (s.startsWith('%')) {
				// Select all text.
				start = 0;
				end = this.e.value.length;
				s = s.substring(1);
			}
			else if (parseNumber()) {
				// Select specific line number.
				const fr = new Reader(0, true, this.e.value);
				let o = fr.offset();
				for (let i = 1; i < number; i++) {
					fr.line(true);
					if (fr.offset() === o) {
						break;
					}
					o = fr.offset();
				}
				start = fr.offset();
				fr.line(false);
				end = fr.offset();
			}
			else if (mode === 'visual' || mode === 'visualline') {
				// Selection when in Visual mode.
				// todo: recognize '< and '>, and insert them on typing ':'? are these registers?
				[start, end] = this.cursor.ordered();
			}
			else {
				// Select current line.
				const br = new Reader(this.cursor.cur, false, this.e.value);
				const fr = new Reader(this.cursor.cur, true, this.e.value);
				br.line(false);
				fr.line(false);
				start = br.offset();
				end = fr.offset();
			}
			// todo: implement more commands? like 'd' for delete, 'g', etc. let's wait until users want it...
			if (!s) {
				// No command. If input was a number, move to the line.
				if (numberstr) {
					this.setCursor(start);
					return;
				}
				throw new Error('unknown range/command');
			}
			if (s.startsWith('s')) {
				s = s.substring(1);
				const sep = s.charAt(0);
				if (!sep) {
					throw new Error('missing separator after s');
				}
				s = s.substring(1);
				// read from x, stop on non-escaped sep.
				const parseWithEscape = (x) => {
					let r = '';
					const iter = x[Symbol.iterator]();
					let p = iter.next();
					while (!p.done) {
						const c = p.value;
						if (c === sep) {
							return [r, x.substring(r.length + 1)];
						}
						else if (c === '\\') {
							p = iter.next();
							if (p.done) {
								throw new Error('unfinished escape');
							}
							const nc = p.value;
							if (nc !== sep) {
								r += c;
							}
							r += nc;
						}
						else {
							r += c;
						}
						p = iter.next();
					}
					throw new Error('missing ending escape');
				};
				let restr;
				let repl;
				[restr, s] = parseWithEscape(s);
				[repl, s] = parseWithEscape(s);
				// JS recognizes replacement strings like "$&", "$1", "$2", while users would
				// expect "&", "\1", "\2". We mostly follow js regexp functionality, but we replace
				// the common replacement strings into js equivalents. We still also leave js
				// specials intact for now. Users will have to cope, or we'll need more elaborate
				// code to do the conversion.
				repl = repl.replaceAll('&', '$$&');
				for (let i = 1; i <= 9; i++) {
					repl = repl.replaceAll('\\' + i, '$$' + i);
				}
				let gflag = '';
				if (s === 'g') {
					gflag = 'g';
				}
				else if (!s) {
					throw new Error('unrecognized trailing text ' + s);
				}
				log('replace', mode, { start, end, restr, repl, gflag });
				const regexp = new RegExp(restr, gflag + 'v');
				const cur = new Cursor(end, start);
				const otext = this.read(cur);
				const ntext = otext.split('\n').map(line => line.replace(regexp, repl)).join('\n');
				const ocur = this.cursor;
				this.replace(cur, ntext, false);
				if (mode === 'visual' || mode === 'visualline') {
					this.cursor = new Cursor(start + ntext.length, start);
				}
				else {
					this.cursor = ocur;
				}
				this.e.setSelectionRange(...this.cursor.ordered());
			}
			else {
				throw new Error('unknown command');
			}
		}
		// Search for a string, interpreted as regular expression.
		// Returns offset of start of match, or < 0 if no match.
		search(offset, s, reverse) {
			this.searchReverse = reverse;
			return this.searchNext(offset, s, false);
		}
		// Search finds the next occurrence of lastSearch/lastSearchRegexp and selects it
		// and scrolls to it.
		//
		// The first character determines the kind of search. If slash, the remainder is
		// interpreted as regular expression. If space (and currently anything else), the
		// remainder is interpreted as a literal string.
		searchNext(offset, s, reverse) {
			if (s !== this.searchLast) {
				this.searchRegexp = new RegExp(s, 'v'); // May throw error.
				this.searchLast = s;
			}
			return this.searchNextRegexp(offset, reverse);
		}
		searchNextRegexp(offset, reverse) {
			if (!this.searchRegexp) {
				return -1;
			}
			if (this.searchReverse) {
				reverse = !reverse;
			}
			if (reverse) {
				return this.searchPrevRegexp(offset);
			}
			const after = this.read(new Cursor(offset + 1, this.e.value.length));
			let r = this.searchRegexp.exec(after);
			if (r !== null) {
				return offset + 1 + r.index;
			}
			const before = this.read(new Cursor(0, offset));
			r = this.searchRegexp.exec(before);
			if (r !== null) {
				return r.index;
			}
			return -1;
		}
		searchPrevRegexp(offset) {
			// todo: find out how to more efficiently search backwards. we now cycle through all matches from the start, keeping the last...
			if (!this.searchRegexp) {
				return -1;
			}
			let index = -1;
			const before = this.read(new Cursor(0, offset));
			let s = before;
			let o = 0;
			for (;;) {
				const r = this.searchRegexp.exec(s);
				if (!r) {
					if (index >= 0) {
						return index;
					}
					break;
				}
				o += r.index;
				index = o;
				s = s.substring(r.index + 1);
				o += 1;
			}
			const after = this.read(new Cursor(offset + 1, this.e.value.length));
			s = after;
			o = offset + 1;
			for (;;) {
				const r = this.searchRegexp.exec(s);
				if (!r) {
					if (index >= 0) {
						return index;
					}
					break;
				}
				o += r.index;
				index = o;
				s = s.substring(r.index + 1);
				o += 1;
			}
			return -1;
		}
		// Indent text covered by cursor.
		indent(c) {
			const t = this.read(c);
			let r = '';
			if (t.length >= 1 && t.charAt(0) !== '\n') {
				r += '\t';
			}
			let i = 0;
			for (let ch of t) {
				r += ch;
				if (ch === '\n') {
					if (i + 1 < t.length && t.charAt(i + 1) !== '\n') {
						r += '\t';
					}
				}
				i++;
			}
			this.replace(c, r, false);
			return r.length;
		}
		// Unindent text covered by cursor.
		unindent(c) {
			const t = this.read(c);
			let nt = t.replace(/\n\t/g, '\n');
			if (nt.length > 0 && nt.charAt(0) === '\t') {
				nt = nt.substring(1);
			}
			this.replace(c, nt, false);
			return nt.length;
		}
		join(c, between) {
			log('join', { c, between });
			let s = this.read(c);
			const newline = s && s.charAt(s.length - 1) === '\n';
			if (newline) {
				s = s.substring(0, s.length - 1);
			}
			let r = '';
			let ro = 0;
			const lines = s.split('\n');
			for (let i = 0; i < lines.length; i++) {
				let line = lines[i];
				if (i !== lines.length - 1) {
					line = line.trimEnd() + between;
				}
				if (i !== 0) {
					line = line.trimStart();
				}
				r += line;
				if (i !== lines.length - 1) {
					ro = r.length - between.length;
				}
			}
			if (newline) {
				r += '\n';
			}
			this.replace(c, r, false);
			this.setCursor(c.ordered()[0] + ro);
		}
		// close history item and set last text used in a command (e.g. newly typed, or
		// replacement text).
		closeHist() {
			this.histOpen = false;
			this.lastKnownValue = this.e.value;
			if (this.needLastCommandText) {
				this.needLastCommandText = false;
				if (this.history.length > 0) {
					this.lastCommandText = this.history[this.history.length - 1].nbuf;
				}
			}
		}
		// Check if current text is different from last known. If so, insert mode has made
		// changes. We add the changes to the history so we can undo and repeat.
		histAfterInsert() {
			let o = this.lastKnownValue;
			let n = this.e.value;
			if (o === n) {
				return;
			}
			let s = 0;
			while (s < o.length && s < n.length && o.charAt(s) === n.charAt(s)) {
				s++;
			}
			let oe = o.length;
			let ne = n.length;
			while (oe > s && ne > s && o.charAt(oe - 1) === n.charAt(ne - 1)) {
				oe--;
				ne--;
			}
			log('found hist', { s, oe, ne, o, n });
			const h = new TextHist(new Cursor(oe, s), o.substring(s, oe), n.substring(s, ne));
			if (!this.histOpen) {
				this.lastCommand = '';
			}
			this.lastCommandText = h.nbuf;
			this.histOpen = false;
			log('add history after insert mode', h, this.lastKnownValue);
			this.history.push(h);
			this.future = [];
			this.lastKnownValue = this.e.value;
		}
		// Replace text at cursor, keeping track of history and updating DOM element. open
		// indicates whether this can be merged into the latest history entry (not used,
		// would be when we control insert mode).
		replace(c, text, open) {
			const wasOpen = this.histOpen;
			this.histOpen = this.histOpen && open && this.future.length === 0;
			if (!wasOpen && !this.histOpen) {
				this.closeHist();
			}
			const modified = this.replaceHist(c, text, true);
			this.histOpen = open;
			return modified;
		}
		// replaceHist updates the DOM element with text at c, and optionally records the
		// change in history for undo/redo.
		replaceHist(c, text, recordHist) {
			log('replaceHist', c, text, recordHist);
			const [s, e, _] = c.ordered();
			if (s === e && !text) {
				return false;
			}
			if (recordHist) {
				const obuf = this.read(new Cursor(e, s));
				let recorded = false;
				if (this.histOpen && this.history.length > 0) {
					const h = this.history[this.history.length - 1];
					log('expanding last history item', h);
					const [c0] = h.replaced.ordered();
					if (c0 + h.nbuf.length === s) {
						h.nbuf += text;
						recorded = true;
					}
				}
				if (!recorded) {
					const h = new TextHist(c, obuf, text);
					log('adding new history item', h);
					this.history.push(h);
				}
				this.future = [];
			}
			this.e.setRangeText(text, s, e, 'select');
			this.lastKnownValue = this.e.value;
			log('lastKnownValue now', this.lastKnownValue);
			return true;
		}
		// undo the latest change, recording it in the redo buffer.
		undo() {
			const h = this.history.pop();
			if (!h) {
				return;
			}
			log('undoing', h);
			// Prepare new last known value, applying change in reverse.
			let last = this.lastKnownValue;
			const [hs] = h.replaced.ordered();
			last = last.substring(0, hs) + h.obuf + last.substring(hs + h.nbuf.length);
			this.future.push(h);
			this.closeHist();
			const [c0] = h.replaced.ordered();
			const c1 = c0 + h.nbuf.length;
			this.replaceHist(new Cursor(c0, c1), h.obuf, false);
			this.lastKnownValue = last; // replaceHist has set lastKnownValue too
			log('lastKnownValue after undo', last);
			this.histOpen = false;
			this.setCursor(c0);
		}
		// redo the last undone change, storing the change in the history again.
		redo() {
			const h = this.future.pop();
			if (!h) {
				return;
			}
			log('redoing', h);
			this.history.push(h);
			this.closeHist();
			this.replaceHist(h.replaced, h.nbuf, false);
			this.histOpen = false;
			const c = h.replaced.start;
			this.setCursor(c);
		}
		// key handles key pressed, some non-vi key combo's are handled first, then keys
		// are handled as vi commands/motions.
		async key(xe) {
			const e = xe;
			log('vi key', xe);
			if (e.key === 'Tab') {
				// Pass on to browser to change focus.
				this.off();
				return;
			}
			xe.preventDefault();
			xe.stopPropagation();
			if (e.key === 'd' && e.ctrlKey) {
				debug = !debug;
				log('debug now', debug);
				return;
			}
			if (e.key === 'h' && e.ctrlKey) {
				log('history');
				for (const h of this.history) {
					log(JSON.stringify(h));
				}
				log('future');
				for (const h of this.future) {
					log(JSON.stringify(h));
				}
				log('histOpen', this.histOpen);
				log('lastKnownValue', this.lastKnownValue);
				log('last', { cmd: this.lastCommand, text: this.lastCommandText, need: this.needLastCommandText });
				return;
			}
			if (e.key === 'Escape' || e.ctrlKey && e.key === '{') {
				this.setMode('command');
				this.setCursor(this.cursor.cur);
				this.commandStr = '';
				this.visualStr = '';
				return;
			}
			// We don't handle shift/ctrl/alt/meta keys explicitly, at most as modifiers to regular keys.
			switch (e.key) {
				case 'Shift':
				case 'Control':
				case 'Alt':
				case 'AltGraph':
				case 'Meta':
					return;
			}
			if (e.isComposing) {
				return;
			}
			// todo: try to unify command & visual handling.
			try {
				if (this.mode === 'command') {
					this.commandStr += e.key;
					await this.command(e.ctrlKey);
				}
				else {
					this.visualStr += e.key;
					await this.visual(e.ctrlKey);
				}
			}
			catch (e) {
				if (e instanceof IncompleteError) {
					if (this.mode === 'command') {
						log('command incomplete', this.commandStr);
					}
					else {
						log('visual incomplete', this.visualStr);
					}
					// Need to wait for more of the command.
				}
				else if (e instanceof BadNumberError || e instanceof BadMotionError || e instanceof NoNumberError || e instanceof BadCommandError) {
					if (this.mode === 'command') {
						log('invalid command, resetting', this.commandStr);
						this.commandStr = '';
					}
					else {
						log('invalid visual, resetting', this.visualStr);
						this.visualStr = '';
					}
					log('bad command', e);
				}
				else {
					throw e;
				}
			}
		}
		// command attempts to execute a command from the command buffer, throwing an error
		// on incomplete and invalid commands.
		async command(ctrl) {
			let cmd = new Cmd(this.commandStr);
			const fr = new Reader(this.cursor.cur, true, this.e.value);
			const br = new Reader(this.cursor.cur, false, this.e.value);
			let modified = false;
			cmd.number();
			let k = cmd.get();
			if (ctrl && cmd.peek() === '') {
				k = 'ctrl-' + k;
			}
			log('command, key', k);
			switch (k) {
				case 'i':
					{
						this.off();
						break;
					}
				case 'I':
					{
						br.line(false);
						this.setCursor(br.offset());
						this.off();
						break;
					}
				case 'a':
					{
						fr.get();
						this.setCursor(fr.offset());
						this.off();
						break;
					}
				case 'A':
					{
						fr.line(false);
						this.setCursor(fr.offset());
						this.off();
						break;
					}
				case 'o':
					{
						fr.line(true);
						modified = this.replace(new Cursor(fr.offset(), fr.offset()), '\n', false);
						this.setCursor(fr.offset());
						this.off();
						break;
					}
				case 'O':
					{
						br.line(false);
						modified = this.replace(new Cursor(br.offset(), br.offset()), '\n', false);
						this.setCursor(br.offset());
						this.off();
						break;
					}
				case 's':
					{
						cmd.times(() => fr.get());
						modified = this.replace(new Cursor(br.offset(), fr.offset()), '', false);
						this.setCursor(fr.offset());
						this.off();
						break;
					}
				case 'S':
					{
						cmd.times(() => fr.line(true));
						modified = this.replace(new Cursor(br.offset(), fr.offset()), "\n", false);
						this.setCursor(fr.offset());
						this.off();
						break;
					}
				// case 'R': // replace, not sure if this is a useful enough
				case 'D':
					{
						// delete lines
						cmd.times(() => fr.line(true));
						modified = this.replace(new Cursor(this.cursor.cur, fr.offset()), "\n", false);
						break;
					}
				case 'ctrl-d':
					this.e.scrollBy(0, this.e.scrollHeight / 2);
					break;
				case 'd':
					{
						// delete
						cmd.number();
						const c = this.motion(cmd, ctrl, br, fr, 'd');
						modified = this.replace(c, '', false);
						this.setCursor(c.ordered()[0]);
						break;
					}
				case 'C':
					{
						// replace lines
						let o = -1;
						for (let i = 0; i < cmd.num; i++) {
							fr.line(false);
							const c = fr.get();
							if (!c) {
								break;
							}
							if (i === cmd.num - 1) {
								o = fr.offset() - 1;
							}
						}
						if (o < 0) {
							o = fr.offset();
						}
						modified = this.replace(new Cursor(this.cursor.cur, o), "", false);
						this.off();
						break;
					}
				case 'c':
					{
						// replace
						cmd.number();
						const c = this.motion(cmd, ctrl, br, fr, 'c');
						modified = this.replace(c, '', false);
						this.off();
						break;
					}
				case 'x':
					{
						// delete
						cmd.times(() => {
							if (fr.peek() !== '\n') {
								fr.get();
							}
						});
						modified = this.replace(new Cursor(this.cursor.cur, fr.offset()), '', false);
						break;
					}
				case 'X':
					{
						// backspace
						cmd.times(() => br.get());
						modified = this.replace(new Cursor(br.offset(), this.cursor.cur), '', false);
						this.setCursor(br.offset());
						break;
					}
				case 'ctrl-y':
					// viewport lines up, we can't tell if cursor is visible, so we don't try to update.
					this.e.scrollBy(0, -cmd.num * lineheight);
					break;
				case 'y':
					{
						// yank
						cmd.number();
						const c = this.motion(cmd, ctrl, br, fr, 'y');
						const s = this.read(c);
						try {
							await clipboardWriteText(s);
						}
						catch (err) {
							alert('writing to clipboard: ' + (err.message || '(no details)'));
						}
						break;
					}
				case 'Y':
					{
						// whole lines
						br.line(false);
						cmd.times(() => fr.line(true));
						const s = this.read(new Cursor(br.offset(), fr.offset()));
						try {
							await clipboardWriteText(s);
						}
						catch (err) {
							alert('writing to clipboard: ' + (err.message || '(no details)'));
						}
						break;
					}
				case 'p':
					{
						// paste
						let s = '';
						try {
							s = await clipboardReadText();
						}
						catch (err) {
							alert('reading from clipboard: ' + (err.message || '(no details)'));
							break;
						}
						if (s.endsWith('\n')) {
							fr.line(true);
						}
						modified = this.replace(new Cursor(fr.offset(), fr.offset()), s, false);
						this.setCursor(fr.offset());
						break;
					}
				case 'P':
					{
						// paste before
						let s = '';
						try {
							s = await clipboardReadText();
						}
						catch (err) {
							alert('reading from clipboard: ' + (err.message || '(no details)'));
							break;
						}
						if (s.endsWith('\n')) {
							br.line(false);
						}
						modified = this.replace(new Cursor(br.offset(), br.offset()), s, false);
						this.setCursor(br.offset());
						break;
					}
				case '<':
					{
						// unindent
						cmd.number();
						br.line(false);
						const c = this.motion(cmd, ctrl, br, fr, '<');
						this.unindent(c);
						modified = true;
						this.setCursor(this.cursor.cur);
						break;
					}
				case '>':
					{
						// indent
						cmd.number();
						br.line(false);
						const c = this.motion(cmd, ctrl, br, fr, '>');
						this.indent(c);
						this.setCursor(this.cursor.cur);
						modified = true;
						break;
					}
				case 'J':
					{
						// join with next line, merging trailing/leading whitespace into a single space
						if (cmd.num === 1) {
							cmd.num = 2;
						}
						cmd.times(() => fr.line(true));
						this.join(new Cursor(fr.offset(), this.cursor.cur), ' ');
						break;
					}
				case '~':
					{
						// swap case of single char
						const start = fr.offset();
						let r = fr.get();
						if (r) {
							const or = r;
							const lower = r.toLowerCase();
							const upper = r.toUpperCase();
							if (r === upper) {
								r = lower;
							}
							else if (r === lower) {
								r = upper;
							}
							if (or !== r) {
								modified = this.replace(new Cursor(start, fr.offset()), r, false);
								this.setCursor(start + r.length);
							}
						}
						break;
					}
				case 'v':
					{
						this.setMode('visual');
						break;
					}
				case 'V':
					{
						br.line(false);
						fr.line(true);
						this.cursor = new Cursor(fr.offset(), br.offset());
						this.e.setSelectionRange(...this.cursor.ordered());
						this.setMode('visualline');
						break;
					}
				case 'ctrl-e':
					// viewport lines down, we can't tell if cursor is visible, so we don't try to update.
					this.e.scrollBy(0, cmd.num * lineheight);
					break;
				case '*':
				case '#':
				case 'n':
				case 'N':
					this.commandSearch(cmd, fr, br, k);
					break;
				case '.':
					{
						const [lastCmd, lastText] = [this.lastCommand, this.lastCommandText];
						log('repeat', lastCmd, lastText);
						if (!lastCmd && lastText) {
							// Just an insert.
							this.replace(new Cursor(this.cursor.cur, this.cursor.cur), lastText, false);
							this.setCursor(this.cursor.cur + lastText.length);
							break;
						}
						// todo: improve this, repeating the command should leave the history-change open, and our call to replace should update it.
						this.commandStr = lastCmd;
						try {
							this.command(false);
							if (lastText) {
								this.replace(new Cursor(this.cursor.cur, this.cursor.cur), lastText, false);
							}
							this.mode = 'command';
						}
						finally {
							this.lastCommand = lastCmd;
							this.lastCommandText = lastText;
							this.commandStr = '';
						}
						return;
					}
				case 'u':
					this.undo();
					break;
				case 'ctrl-r':
					this.redo();
					break;
				case 'g':
					{
						let c = cmd.get();
						if (ctrl && cmd.peek() === '') {
							c = 'ctrl-' + c;
						}
						switch (c) {
							case 'q':
								{
									cmd.number();
									const nc = this.motion(cmd, ctrl, br, fr, 'q');
									const nr = new Reader(nc.ordered()[0], false, br.s);
									nr.line(false);
									const c = new Cursor(nc.ordered()[1], nr.offset());
									const text = wrap(this.read(c));
									modified = this.replace(c, text, false);
									const nbr = new Reader(c.start + text.length, false, this.e.value);
									nbr.line(false);
									this.setCursor(nbr.offset());
									break;
								}
							case 'J':
								{
									if (cmd.num === 1) {
										cmd.num = 2;
									}
									cmd.times(() => fr.line(true));
									this.join(new Cursor(fr.offset(), this.cursor.cur), '');
									break;
								}
							default:
								throw new BadCommandError('unrecognized');
						}
						break;
					}
				case 'ctrl-b':
					this.e.scrollBy(0, -this.e.scrollHeight);
					break;
				case 'ctrl-f':
					this.e.scrollBy(0, this.e.scrollHeight);
					break;
				case '/':
				case '?':
				case ':':
					this.extraline(cmd, k);
					break;
				default:
					cmd = new Cmd(this.commandStr);
					cmd.number();
					const nc = this.motion(cmd, ctrl, br, fr, '');
					this.setCursor(nc.cur);
			}
			if (modified) {
				this.lastCommand = this.commandStr;
				this.lastCommandText = '';
				this.needLastCommandText = this.mode === 'insert';
			}
			log('command completed', this.commandStr);
			this.commandStr = '';
		}
		// visual is like command but for visual and visualline modes.
		async visual(ctrl) {
			const line = this.mode === 'visualline';
			let cmd = new Cmd(this.visualStr);
			let fr = new Reader(this.cursor.cur, true, this.e.value);
			let br = new Reader(this.cursor.cur, false, this.e.value);
			let modified = false;
			const [c0] = this.cursor.ordered();
			cmd.number();
			let k = cmd.get();
			if (ctrl && cmd.peek() === '') {
				k = 'ctrl-' + k;
			}
			log('visual key', k, this.cursor);
			switch (k) {
				case 'v':
					{
						this.setMode('visual');
						this.visualStr = '';
						return;
					}
				case 'V':
					{
						let [s, e] = this.cursor.ordered();
						const xfr = new Reader(e, true, this.e.value);
						const xbr = new Reader(s, false, this.e.value);
						xbr.line(false);
						xfr.line(false);
						[s, e] = [xbr.offset(), xfr.offset()];
						if (!this.cursor.isForward()) {
							[s, e] = [e, s];
						}
						this.cursor = new Cursor(e, s);
						this.e.setSelectionRange(...this.cursor.ordered());
						this.setMode('visualline');
						this.visualStr = '';
						return;
					}
				case 'd':
					{
						// delete
						modified = this.replace(this.cursor, '', false);
						this.cursor = new Cursor(c0, c0);
						break;
					}
				case 's':
				case 'c':
					{
						modified = this.replace(this.cursor, '', false);
						this.cursor = new Cursor(c0, c0);
						this.off();
						break;
					}
				case 'y':
					{
						const s = this.read(this.cursor);
						try {
							await clipboardWriteText(s);
						}
						catch (err) {
							alert('writing to clipboard: ' + (err.message || '(no details)'));
						}
						this.cursor = this.cursor.atStart();
						break;
					}
				case 'p':
					{
						let s = '';
						try {
							s = await clipboardReadText();
						}
						catch (err) {
							alert('reading from clipboard: ' + (err.message || '(no details)'));
							break;
						}
						modified = this.replace(this.cursor, s, false);
						this.cursor = new Cursor(c0 + s.length, c0);
						break;
					}
				case 'ctrl-e':
					// viewport lines down, we can't tell if cursor is visible, so we don't try to update.
					this.e.scrollBy(0, cmd.num * lineheight);
					this.visualStr = '';
					return;
				case '<':
					{
						const n = this.unindent(this.cursor);
						this.cursor = new Cursor(c0 + n, c0);
						break;
					}
				case '>':
					{
						const n = this.indent(this.cursor);
						this.cursor = new Cursor(c0 + n, c0);
						break;
					}
				case 'J':
					{
						this.join(this.cursor, ' ');
						break;
					}
				case '~':
					{
						let s = "";
						const buf = this.read(this.cursor);
						for (let r of buf) {
							const lower = r.toLowerCase();
							const upper = r.toUpperCase();
							if (r === upper) {
								r = lower;
							}
							else if (r === lower) {
								r = upper;
							}
							s += r;
						}
						this.replace(this.cursor, s, false);
						this.cursor = new Cursor(c0 + s.length, c0);
						break;
					}
				case 'o':
					{
						// Swap direction.
						this.cursor = new Cursor(this.cursor.start, this.cursor.cur);
						this.e.setSelectionRange(...this.cursor.ordered());
						this.visualStr = '';
						return;
					}
				case 'g':
					{
						const kk = cmd.get();
						switch (kk) {
							case 'q':
								{
									const text = wrap(this.read(this.cursor));
									modified = this.replace(this.cursor, text, false);
									const nbr = new Reader(this.cursor.start + text.length, false, this.e.value);
									nbr.line(false);
									this.setCursor(nbr.offset());
									break;
								}
							case 'J':
								this.join(this.cursor, '');
								break;
							default:
								throw new BadCommandError('unknown key');
						}
						break;
					}
				case '*':
				case '#':
				case 'n':
				case 'N':
					this.commandSearch(cmd, fr, br, k);
					this.visualStr = '';
					return;
				case '/':
				case '?':
				case ':':
					this.extraline(cmd, k);
					this.visualStr = '';
					return;
				default:
					cmd = new Cmd(this.visualStr);
					cmd.number();
					const oc = this.cursor;
					// In visualline mode, the selection includes the ending newline. But motions assume
					// that newline isn't included. We compensate the cursor while executing the motion.
					if (line && new Reader(this.cursor.ordered()[1], false, this.e.value).peek() === '\n') {
						if (this.cursor.isForward()) {
							this.cursor.cur--;
							br = new Reader(this.cursor.cur, false, this.e.value);
							fr = new Reader(this.cursor.cur, true, this.e.value);
						}
						else {
							this.cursor.start--;
						}
					}
					try {
						const nc = this.motion(cmd, ctrl, br, fr, '');
						log('visual motion', nc, this.cursor);
						this.cursor = nc;
					}
					catch (e) {
						// Restore after possible line-compensation.
						this.cursor = oc;
						throw e;
					}
					if (line) {
						// Expand to whole lines.
						let [s, e, dir] = this.cursor.ordered();
						const nbr = new Reader(s, false, this.e.value);
						nbr.line(false);
						s = nbr.offset();
						const nfr = new Reader(e, true, this.e.value);
						nfr.line(true);
						e = nfr.offset();
						if (dir === 'forward') {
							this.cursor = new Cursor(e, s);
						}
						else {
							this.cursor = new Cursor(s, e);
						}
					}
					this.e.setSelectionRange(...this.cursor.ordered());
					this.visualStr = '';
					return;
			}
			if (modified) { } // Unused.
			this.visualStr = '';
			this.setCursor(this.cursor.cur);
			this.setMode('command');
		}
		// commandSearchMove adjusts the cursor/selection after a search, based on mode.
		commandSearchMove(mode, reverse, offset) {
			// Adjust offset to cover whole line.
			if (mode === 'visualline') {
				const r = new Reader(offset, !reverse, this.e.value);
				r.line(!reverse);
				offset = r.offset();
			}
			if (mode === 'visual' || mode === 'visualline') {
				this.cursor = new Cursor(offset, this.cursor.start);
				this.e.setSelectionRange(...this.cursor.ordered());
			}
			else {
				this.setCursor(offset);
			}
		}
		// commandSearch handles a search command key (k), for both command and visual modes.
		// cmd is used for number of times to execute the command.
		commandSearch(cmd, fr, br, k) {
			switch (k) {
				case '*':
				case '#':
					{
						br.nonwhitespacepunct();
						fr.nonwhitespacepunct();
						const s = this.read(new Cursor(br.offset(), fr.offset()));
						const sre = "\\b" + escapeRegExp(s) + "\\b";
						this.searchReverse = k === '#';
						let o = this.cursor.cur;
						for (let i = 0; i < cmd.num; i++) {
							const no = this.searchNext(o, sre, false);
							if (no < 0 || no === o) {
								break;
							}
							o = no;
						}
						if (o >= 0) {
							this.commandSearchMove(this.mode, this.searchReverse, o);
						}
						break;
					}
				case 'n':
				case 'N':
					{
						if (!this.searchRegexp) {
							break;
						}
						let o = this.cursor.cur;
						for (let i = 0; i < cmd.num; i++) {
							const no = this.searchNextRegexp(o, k === 'N');
							if (no < 0 || no === o) {
								break;
							}
							o = no;
						}
						if (o >= 0) {
							let reverse = k === 'N';
							if (this.searchReverse) {
								reverse = !reverse;
							}
							this.commandSearchMove(this.mode, reverse, o);
						}
						break;
					}
			}
		}
		// Add input element/line to DOM for a search or ex command.
		extraline(cmd, k) {
			const origMode = this.mode;
			this.off();
			const box = document.createElement('div');
			const r = this.e.getBoundingClientRect();
			const xoff = window.scrollX;
			const yoff = window.scrollY;
			box.style.position = 'absolute';
			// todo: place above if below would make it fall outside the document? right now, we would enlarge the document and setting focus scrolls the page
			box.style.left = Math.floor(xoff + r.x) + 'px';
			box.style.top = Math.ceil(yoff + r.y + r.height + 2) + 'px';
			box.style.width = Math.floor(r.width) + 'px';
			box.style.display = 'flex';
			box.style.backgroundColor = 'white';
			box.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.2)';
			box.style.zIndex = '2147483647'; // Max value.
			const input = document.createElement('input');
			input.style.width = '100%';
			const op = document.createElement('div');
			op.style.padding = '0 .5em';
			op.appendChild(document.createTextNode(k));
			box.append(op, input);
			// We add element to body, to prevent messing with expected DOM structure and related styling.
			document.body.appendChild(box); // todo: find position relative to document.body?
			input.focus();
			const cancel = () => {
				if (box.parentNode) {
					box.remove();
				}
				this.e.focus();
				this.on(origMode);
			};
			input.addEventListener('blur', () => {
				cancel();
			});
			let history = k === ':' ? this.exHistory : this.searchHistory;
			let histindex = history.length;
			input.addEventListener('keydown', (ev) => {
				log('input key', ev.key);
				if (ev.key === 'Escape') {
					ev.preventDefault();
					cancel();
				}
				else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
					ev.preventDefault();
					const i = histindex + (ev.key === 'ArrowUp' ? -1 : 1);
					if (i >= 0) {
						if (i >= history.length) {
							input.value = '';
							histindex = history.length;
						}
						else {
							input.value = history[i];
							histindex = i;
						}
					}
				}
				else if (ev.key === 'Enter') {
					ev.preventDefault();
					if (!this.e.value) {
						cancel();
						return;
					}
					if (k === ':') {
						try {
							this.ex(origMode, input.value);
						}
						catch (err) {
							// Keep line, so user can fix it and try again.
							log('ex error', err);
							// note: without setTimeout, firefox will throw a NS_ERROR_FAILURE error
							// We are still not logging, as that would blur the input element and hide it.
							// setTimeout(() => alert(err.message), 0)
							return;
						}
					}
					else {
						// todo: could implement offset after closing /: /regexp/2 searches for regexp, then moves 2 lines down.
						let o = this.cursor.cur;
						for (let i = 0; i < cmd.num; i++) {
							const no = this.search(o, input.value, k === '?');
							if (no < 0 || o === no) {
								break;
							}
							o = no;
						}
						if (o >= 0) {
							this.commandSearchMove(origMode, k === '?', o);
						}
					}
					history.push(input.value);
					histindex = history.length;
					cancel();
				}
			});
		}
	}
	// viSelectOn enables basic key handling on a select element.
	// Vi key handling is basic: we don't get key events when the select is open
	// with options visible (at least on linux x11).
	const viSelectOn = (elem) => {
		const xelem = elem;
		if (xelem._viEditingModeSelect) {
			return;
		}
		log('viSelectOn', elem);
		const state = {
			origBoxShadow: elem.style.boxShadow,
			origOutline: elem.style.outline
		};
		elem.style.boxShadow = '0 0 6px 2px #f9bc07'; // yellow
		elem.style.outline = '2px solid #f9bc07';
		xelem._viEditingModeSelect = state;
		// todo: figure out why keyboard events no longer fire when select is open with options visible (on linux x11). we don't get a blur event either, but it feels like the focus is out of the document.
		const keydown = (xe) => {
			const ev = xe;
			log('select keydown', xe);
			if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) {
				return;
			}
			if (elem.options.length === 0) {
				return;
			}
			// todo: handle shift to extend selection in case of multiselect. and ctrl to only move focus, not change selection.
			const select = (i) => {
				if (i >= 0 && i < elem.options.length) {
					elem.selectedIndex = i;
				}
			};
			switch (ev.key) {
				case 'j':
					// Down.
					select(elem.selectedIndex + 1);
					break;
				case 'k':
					// Up.
					select(elem.selectedIndex - 1);
					break;
				case '0':
					// First.
					select(0);
					break;
				case '$':
					// Last.
					select(elem.options.length - 1);
					break;
				default:
					return;
			}
			ev.preventDefault();
			ev.stopPropagation();
		};
		const unregister = () => {
			log('unregister select');
			elem.removeEventListener('blur', unregister);
			elem.removeEventListener('keydown', keydown);
			elem.style.boxShadow = state.origBoxShadow;
			elem.style.outline = state.origOutline;
			delete xelem._viEditingModeSelect;
		};
		elem.addEventListener('blur', unregister);
		elem.addEventListener('keydown', keydown);
	};
	// viOn initializes an Edit object on an HTML element (if first time), and turns
	// command mode on.
	const viOn = (t) => {
		log('viOn', t);
		let e;
		const xt = t;
		if (xt._viEditingModeEdit) {
			if (xt._viEditingModeEdit instanceof Edit) {
				e = xt._viEditingModeEdit;
			}
			else {
				return;
			}
		}
		else {
			e = new Edit(t);
			xt._viEditingModeEdit = e;
		}
		e.on();
	};
	// Register a document-level key handler for Escape and ctrl-{, to enable vi mode
	// on textarea/input/select elements.
	document.addEventListener('keydown', function (e) {
		log('document', e);
		if (!(e.key === 'Escape' || e.ctrlKey && e.key === '{')) {
			return;
		}
		const t = e.target;
		if (t instanceof HTMLTextAreaElement) {
			viOn(t);
		}
		else if (t instanceof HTMLInputElement) {
			// See setSelectionRange in table https://html.spec.whatwg.org/multipage/input.html#input-type-attr-summary
			const ok = ['text', 'search', 'tel', 'url', 'password'];
			if (ok.includes(t.type)) {
				viOn(t);
			}
		}
		else if (t instanceof HTMLSelectElement) {
			viSelectOn(t);
		}
	});
})();
