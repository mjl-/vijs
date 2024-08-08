// License: MIT, author: mechiel@ueber.net. See LICENSE.MIT.

;(function() {
let debug = false // Toggle with ctrl+d in command mode.
const lineheight = 20 // Used for scrolling with ctrl-e. todo: figure out heuristic for line height, used for scrolling

// We don't log with console.log, only through log().
const log = (...l: any[]) => {
	if (debug) {
		console.debug(...l)
	}
}

// When accessing clipboard, we first request permission. Surprising the
// browser isn't doing that automatically (perhaps special behaviour for
// addons? or probably it does check anyway and this is superfluous). We
// actually ignore whatever permission we think we got. If we don't have
// permission, we'll get an error to read/write the clipboard anyway. We just
// want to ensure the browser asks the user if the browser supports it.

const clipboardWriteText = async (s: string) => {
	const w = window as any
	!w.browser?.permissions?.request || await w.browser.permissions.request({permissions: ['clipboardWrite']})
	await window.navigator.clipboard.writeText(s)
}

const clipboardReadText = async (): Promise<string> => {
	const w = window as any
	!w.browser?.permissions?.request || await w.browser.permissions.request({permissions: ['clipboardRead']})
	return await window.navigator.clipboard.readText()
}

// wrap text at 78 characters, keep leading spaces or tabs when wrapping, and recognizing lines starting with "- " as enumeration.
const wrap = (s: string): string => {
	// Rather hacky, to be rewritten more properly.
	// We read the input into tokens: a word, space, newline, leading whitespace.
	// Then we generate output tokens, looking back in output and ahead for next tokens
	// to determine if we should skip a space, insert a newline for wrapping, etc.

	type tokenType = 'word' | 'space' | 'newline' | 'leadws'
	type token = [tokenType, string]

	const tokens: token[] = []
	let w = ''
	let linestart = true
	const flush = () => {
		if (!w) {
			return
		}
		if (linestart) {
			tokens.push(['leadws', w])
		} else {
			tokens.push(['word', w])
		}
		w = ''
		linestart = false
	}
	for (const c of s) {
		if (c === '\n') {
			if (linestart && w) {
				w = ''
			}
			flush()
			tokens.push(['newline', ''])
			linestart = true
		} else if (c === ' ' || c === '\t') {
			if (linestart) {
				w += c
				continue
			}
			flush()
			const t = tokens[tokens.length-1]
			if (t[0] === 'word') {
				tokens.push(['space', ''])
			}
		} else {
			if (w && linestart) {
				flush()
			}
			linestart = false
			w += c
		}
	}
	flush()

	log('tokens in', tokens)

	// Process input tokens into output tokens.
	let linelen = 0
	let lineleadws = ''
	let moreleadws = '' // empty, or set to two spaces when first token on line was "-" (enumeration).
	let out: token[] = []
	for (let i = 0; i < tokens.length; i++) {
		// Current, prev and next token and data.
		const [t, c] = tokens[i]
		const [pt] = tokens[i-1] || ['', '']
		const [nt, nc] = tokens[i+1] || ['', '']
		const [nnt, nnc] = tokens[i+2] || ['', '']
		if (t === 'word') {
			// If it doesn't fit, wrap by starting with new line.
			if (linelen > 0 && linelen+c.length >= 78) {
				out.push(['newline', '\n'])
				// Keep same leading whitespace.
				if (lineleadws || moreleadws) {
					out.push(['leadws', lineleadws+moreleadws])
				}
				linelen = lineleadws.length+moreleadws.length
			} else if (out.length > 0 && out[out.length-1][0] === 'word') {
				out.push(['space', ' '])
			}
			if (c === '-' && (out.length === 0 || out[out.length-1][0] === 'newline' || out.length === 1 && out[out.length-1][0] === 'leadws' || (out.length > 1 && out[out.length-1][0] === 'leadws' && out[out.length-2][0] === 'newline'))) {
				moreleadws = '  '
			}
			out.push(['word', c])
			linelen += c.length
		} else if (t === 'space') {
			if (nt !== 'word') {
				continue
			}
			if (linelen > 0 && linelen+1+nc.length < 78) {
				out.push(['space', ' '])
				out.push(['word', nc])
				linelen += 1+nc.length
				i++
			} else {
				out.push(['newline', '\n'])
				out.push(['leadws', lineleadws+moreleadws])
				linelen = lineleadws.length+moreleadws.length
			}
		} else if (t === 'newline') {
			if (pt && pt !== 'newline' && (nt == 'word' && nc !== '-' || nt === 'leadws' && (nc == lineleadws || nc === lineleadws+moreleadws) && !(nnt === 'word' && nnc === '-'))) {
				// Merge next line into this.
				if (nt === 'leadws') {
					i++
				}
				continue
			}
			lineleadws = ''
			moreleadws = ''
			out.push(['newline', '\n'])
			linelen = 0
		} else if (t === 'leadws') {
			linelen = c.length
			lineleadws = c
			moreleadws = ''
			out.push(['leadws', c])
		}
	}

	log('tokens out', out)

	return out.map(t => t[1]).join('')
}

// We keep track of the cursor/selection. Cur is where new text is typed, start
// is the start of selection. If there is no selection, cur is equal to start.
// Direction is implied by cur & start.
class Cursor {
	constructor(public cur: number, public start: number) {
		this.cur = cur
		this.start = start
	}

	// As expected by setSelectionRange.
	ordered(): [number, number, 'forward' | 'backward'] {
		let s = this.cur, e = this.start
		if (s > e) {
			return [e, s, 'backward']
		}
		return [s, e, 'forward']
	}
}

// We build up multicharacter commands, try to parse them. These errors can
// happen, some cause us to gather more data, others to clear the command
// buffer.
class IncompleteError extends Error {}
class BadNumberError extends Error {}
class BadMoveError extends Error {}
class NoNumberError extends Error {}
class BadCommandError extends Error{}

// Cmd is used for parsing a (partial) command.
class Cmd {
	num = 1 // An implied single execution of commands. Overridden if command buffer starts with number.
	numStr = ''

	constructor(public s: string) {
		this.s = s // e.g. just "d", or "2j", etc.
	}

	// Return next char without consuming. Empty when at end.
	peek(): string {
		if (this.s == '') {
			return ''
		}
		return this.s.charAt(0) || ''
	}

	// Return next character and consume it. Throws error when at end.
	get(): string {
		if (this.s === '') {
			throw new IncompleteError('incomplete')
		}
		const s = this.s.charAt(0) || ''
		this.s = this.s.substring(1)
		return s
	}

	// Parse number if present, otherwise stay at 1.
	number() {
		this.numStr = ''
		while (true) {
			const r = this.peek()
			if (!r) {
				break
			}
			const cp = r.codePointAt(0)
			if (!(cp && cp >= '1'.codePointAt(0)! && cp <= '9'.codePointAt(0)! || this.numStr !== '' && r === '0')) {
				break
			}
			this.numStr += r
			this.get()
		}
		if (!this.numStr) {
			this.num = 1
			return
		}
		const v = parseInt(this.numStr)
		if (!v) {
			throw new BadNumberError("bad number")
		}
		this.num = v
	}

	// Ensure buffer doesn't start with number.
	noNumber() {
		if (this.num !== 1) {
			throw new NoNumberError('no number allowed')
		}
	}

	// Execute fn "num" times (default 1).
	times(fn: () => void) {
		for (let i = 0; i < this.num; i++) {
			fn()
		}
	}
}

// Source is where we can read data from. Peek or get and consume a character.
interface Source {
	peek(): string
	get(): string
}

// ForwardSource returns characters from a string, moving forward.
class ForwardSource {
	constructor(public s: string) {
		this.s = s
	}

	peek(): string {
		if (!this.s) {
			return ''
		}
		return this.s.charAt(0) || ''
	}

	get(): string {
		if (!this.s) {
			return ''
		}
		const r = this.s.charAt(0) || ''
		this.s = this.s.substring(1)
		return r
	}
}

// BackwardSource returns characters from a string, moving backwards.
class BackwardSource {
	constructor(public s: string) {
		this.s = s
	}

	peek(): string {
		if (!this.s) {
			return ''
		}
		return this.s.charAt(this.s.length-1) || ''
	}

	get(): string {
		if (!this.s) {
			return ''
		}
		const r = this.s.charAt(this.s.length-1) || ''
		this.s = this.s.substring(0, this.s.length-1)
		return r
	}
}

const isSpace = (c: string) => c.trim() === '' // todo: better
const isPunct = (c: string) => /\p{P}/u.test(c)

// Reader has convenience functions to navigate text (in a Source). Go to
// start/end of line, etc. Used to implement vi move commands.
class Reader {
	n: number // Number of characters read, excluding peek.
	src: Source

	constructor(public start: number, public forward: boolean, s: string) {
		if (forward) {
			this.src = new ForwardSource(s.substring(start))
		} else {
			this.src = new BackwardSource(s.substring(0, start))
		}
		this.n = 0
		this.forward = forward
	}

	// Offset, in characters.
	offset(): number {
		return this.start+ (this.forward ? this.n : -this.n)
	}

	peek(): string {
		return this.src.peek()
	}

	get(): string {
		const c = this.src.get()
		if (c) {
			this.n++
		}
		return c
	}

	line(includeNewline: boolean): [string, boolean] {
		let s = ''
		let eof = false
		while (true) {
			const c = this.peek()
			if (!c) {
				eof = !s
				break
			}
			if (c == '\n') {
				if (includeNewline) {
					this.get()
				}
				break
			}
			this.get()
			s += c
		}
		return [s, eof]
	}

	gather(keep: (c: string) => boolean): [string, boolean] {
		let s = ''
		let eof = false
		while (true) {
			const c = this.peek()
			if (!c) {
				eof = !s
				break
			}
			if (!keep(c)) {
				break
			}
			this.get()
			s += c
		}
		return [s, eof]
	}

	whitespace(newline: boolean): [string, boolean] {
		return this.gather(c => (c !== '\n' || newline) && isSpace(c))
	}

	nonwhitespace(): [string, boolean] {
		return this.gather(c => !isSpace(c))
	}

	whitespacepunct(newline: boolean): [string, boolean] {
		return this.gather(c => (c !== '\n' || newline) && (isSpace(c) || isPunct(c)))
	}

	nonwhitespacepunct(): [string, boolean] {
		return this.gather(c => !isSpace(c) && !isPunct(c))
	}

	punctuation(): [string, boolean] {
		return this.gather(c => isPunct(c))
	}
}

// TextHist is an entry in the undo/redo history.
class TextHist {
	constructor(public c: Cursor, public obuf: string, public nbuf: string) {
		this.c = c // Range that was replaced (from original).
		this.obuf = obuf // Original text that was replaced.
		this.nbuf = nbuf // New text, placed instead of obuf, at c.
	}
}

type mode = 'insert' | 'command' | 'visual' | 'visualline'

// Edit tracks vi editing state for a textarea or input element.
class Edit {
	// We highlight elements with a box-shadow, but store the original to
	// restore when going into insert mode.
	origBoxShadow = ''

	mode: mode
	cursor: Cursor
	// Command so far. We try to parse it as a full command each time a key
	// is pressed. Once we handled a command, we clear it to start a new
	// command.
	commandStr = ''
	visualStr = '' // Like commandStr, but for visual mode.

	// For searching. Only with "*" and "n" and "N" for now.
	lastSearch = ''
	lastSearchRegexp: RegExp | undefined
	lastSearchRegexpString = ''

	// For undo/redo.
	history: TextHist[] = []
	future: TextHist[] = []
	histOpen = false
	lastKnownValue: string // For finding changes made during insert mode, when we enter command mode again.

	// For repeat.
	lastCommand = '' // Empty command with lastCommandText is a basic text insert.
	needLastCommandText = false
	lastCommandText = '' // Text inserted as part of last command.

	// handlers bound to this...
	keydown: (e: Event) => void
	noninsertblur: (e: Event) => void
	mouseupx: (e: Event) => void
	tabdown: (e: Event) => void
	blurx: (e: Event) => void

	constructor(public e: HTMLTextAreaElement | HTMLInputElement) {
		this.e = e
		this.lastKnownValue = e.value
		this.mode = 'insert'

		this.cursor = new Cursor(0, 0)
		this.keydown = this.key.bind(this)
		this.noninsertblur = (() => this.off(true)).bind(this)
		this.mouseupx = this.mouseup.bind(this)
		this.tabdown = this.tab.bind(this)
		this.blurx = this.insertblur.bind(this)
		log('Edit for elem', e)
	}

	// elemCursor returns a cursor based on current text selection of element.
	elemCursor(): Cursor {
		let start = this.e.selectionStart || 0
		let cur = this.e.selectionEnd || 0
		if (this.e.selectionDirection === 'backward') {
			[start, cur] = [cur, start]
		}
		return new Cursor(cur, start)
	}

	// set mode, and restore/set box-shadow style.
	setMode(mode: mode) {
		if (mode === 'insert') {
			this.mode = mode
			this.e.style.boxShadow = this.origBoxShadow
			this.origBoxShadow = ''
			return
		}

		if (this.mode === 'insert') {
			this.origBoxShadow = this.e.style.boxShadow
		}
		this.mode = mode
		if (mode === 'command') {
			this.e.style.boxShadow = '0 0 4px 2px #2190f2'
		} else if (mode === 'visual') {
			this.e.style.boxShadow = '0 0 6px 2px #f9bc07'
		} else if (mode === 'visualline') {
			this.e.style.boxShadow = '0 0 6px 2px #57db0d'
		}
	}

	// Enable editing mode, taking control of the element.
	on() {
		this.cursor = this.elemCursor()
		if (this.cursor.cur === this.cursor.start) {
			this.setMode('command')
		} else {
			this.setMode('visual')
		}
		this.histAfterInsert()

		this.e.addEventListener('keydown', this.keydown)
		this.e.addEventListener('blur', this.noninsertblur)
		this.e.addEventListener('mouseup', this.mouseupx)

		this.e.removeEventListener('keydown', this.tabdown)
		this.e.removeEventListener('blur', this.blurx)
	}

	// Go back to insert mode, giving control back to browser.
	off(blur?: boolean) {
		log('vi off', this)
		this.mode = 'insert'
		this.histOpen = false
		this.lastKnownValue = this.e.value

		this.setMode('insert')

		this.e.removeEventListener('keydown', this.keydown)
		this.e.removeEventListener('blur', this.noninsertblur)
		this.e.removeEventListener('mouseup', this.mouseupx)

		if (blur) {
			return
		}
		this.e.addEventListener('keydown', this.tabdown)
		this.e.addEventListener('blur', this.blurx)
	}

	// Tab is called when tab is hit in insert mode, but only after command mode has
	// been enabled once. Tab would normally change focus. But we want to be able to
	// insert a tab when editing text in a textarea. So we do it ourselves. This
	// handler is removed on blur. So next time the element is focused, tab will get
	// its default behaviour of changing focus again, until the user has entered
	// command mode. Hitting tab while in command mode results in the default behaviour
	// of changing focus.
	tab(xe: Event) {
		const e = xe as KeyboardEvent
		if (e.key !== 'Tab' || this.e instanceof HTMLInputElement) {
			return
		}
		e.preventDefault()
		e.stopPropagation()
		this.cursor = this.elemCursor()
		this.replace(this.cursor, '\t', false)
		this.setCursor(this.cursor.cur+1)
	}

	// Blur is registered when changing from command mode to insert mode. When an
	// element is blurred, the special tab-handling behaviour is unregistered.
	insertblur() {
		this.e.removeEventListener('keydown', this.tabdown)
		this.e.removeEventListener('blur', this.blurx)
	}

	// Mouseup is registered while in command/visual mode. It switches to
	// insert mode and syncs the cursor, the user likely clicked somewhere.
	mouseup() {
		this.off()
		this.cursor = this.elemCursor()
	}

	// Set a new cursor (no selection) and update the selected range in the DOM element.
	setCursor(index: number) {
		log('setCursor', index)
		this.cursor.cur = this.cursor.start = index
		this.e.setSelectionRange(...this.cursor.ordered())
		// todo: scroll to ensure visibility. possibly call focus(), trigger a keypress, set selectionrange (possibly also without selection)
	}

	// Move tries to execute a vi move command, returning the resulting new offset.
	move(cmd: Cmd, br: Reader, fr: Reader, endLineChar: string): number {
		log('trying move', cmd.s)
		const r = cmd.get()

		const atnewline = fr.peek() === '\n'
		const beforenewline = () => {
			let o = fr.offset()
			if (this.mode === 'command' && !atnewline && fr.peek() === '\n') {
				o--
			}
			return o
		}

		switch (r) {
		case '0':
			// Start of line.
			br.line(false)
			return br.offset()
		case '$':
			// End of line.
			cmd.noNumber()
			fr.line(false)
			return beforenewline()
		case '^':
		{
			// To first non-whitespace character on line.
			br.line(false)
			const nr = new Reader(br.offset(), true, this.e.value)
			nr.whitespace(false)
			return nr.offset()
		}
		case 'w':
			cmd.times(() => {
				const o = fr.offset()
				fr.nonwhitespacepunct()
				if (o  === fr.offset()) {
					fr.punctuation()
				}
				fr.whitespace(true)
			})
			return fr.offset()
		case 'W':
			// word
			cmd.times(() => {
				fr.nonwhitespace()
				fr.whitespace(true)
			})
			return fr.offset()
		case 'b':
			// to begin of (previous) word
			cmd.times(() => {
				const o = br.offset()
				br.whitespacepunct(true)
				if (o === br.offset()) {
					br.nonwhitespacepunct()
				}
			})
			return br.offset()
		case 'B':
			// like 'b', skip interpunction too
			cmd.times(() => {
				br.whitespace(true)
				br.nonwhitespace()
			})
			return br.offset()
		case 'e':
			// to end of (next) word
			cmd.times(() => {
				fr.whitespace(true)
				fr.nonwhitespacepunct()
			})
			return fr.offset()
		case 'E':
			// like 'e', skip interpunction too
			cmd.times(() => {
				fr.whitespace(true)
				fr.nonwhitespace()
			})
			return fr.offset()
		case 'h':
			// left
			cmd.times(() => {
				const c = br.peek()
				if (c && c !== '\n') {
					br.get()
				}
			})
			return br.offset()
		case 'l':
			// right
			cmd.times(() => {
				const c = fr.peek()
				if (c && c !== '\n') {
					fr.get()
				}
			})
			return beforenewline()
		case 'k':
			// up
		{
			const [so, _] = br.line(false)
			cmd.times(() => {
				br.line(true)
				br.line(false)
			})
			const rr = new Reader(br.offset(), true, this.e.value)
			for (let i = 0; i < so.length; i++) {
				const c = rr.peek()
				if (!c || c === '\n') {
					break
				}
				rr.get()
			}
			return rr.offset()
		}
		case 'j':
			// down
		{
			const [so, _] = br.line(false)
			cmd.times(() => {
				fr.line(true)
			})
			for (let i = 0; i < so.length; i++) {
				const c = fr.peek()
				if (!c || c === '\n') {
					break
				}
				fr.get()
			}
			return fr.offset()
		}
		case 'G':
		{
			if (cmd.numStr === "") {
				// to eof
				return this.e.value.length
			}
			// to absolute line number (1 is first)
			const r = new Reader(0, true, this.e.value)
			for (let i = 1; i < cmd.num; i++) {
				const [_, eof] = r.line(true)
				if (eof) {
					break
				}
			}
			return r.offset()
		}
		case '%':
		{
			// to matching struct key
			cmd.noNumber()
			const starts = "{[(<"
			const ends = "}])>"

			const c = fr.peek()
			if (c && starts.includes(c)) {
				fr.get()
				const index = starts.indexOf(c)
				if (this.expandNested(fr, starts[index], ends[index]) > 0) {
					return fr.offset()
				}
			}
			if (c && ends.includes(c)) {
				br.get()
				const index = ends.indexOf(c)
				if (this.expandNested(br, ends[index], starts[index]) > 0) {
					br.get()
					return br.offset()
				}
			}
			break
		}
		case '{':
			// Backwards to empty line.
			cmd.times(() => {
				br.line(false)
				while (true) {
					const o = br.offset()
					br.get()
					br.line(false)
					const c = br.peek()
					if (!c || br.offset() === o-1) {
						break
					}
				}
			})
			return br.offset()
		case '}':
			// Forward to empty line.
			cmd.times(() => {
				while (true) {
					fr.get()
					fr.line(true)
					const c = fr.peek()
					if (!c || c === '\n') {
						break
					}
				}
			})
			return fr.offset()

		default:
			if (r === endLineChar) {
				br.line(false)
				cmd.times(() => fr.line(true))
				return fr.offset()
			}
		}
		throw new BadMoveError('bad move command')
	}

	// Match nested characters like "[" and "]", keeping nesting into
	// account. Returns new offset. Used for implementing "%".
	expandNested(r: Reader, up: string, down: string): number {
		let nested = 1
		while (true) {
			const c = r.peek()
			if (!c) {
				return 0
			}
			if (c === down) {
				nested--
			} else if (c == up) {
				nested++
			}
			if (nested == 0) {
				return r.n
			}
			r.get()
		}
	}

	// Read text at cursor (selection or empty).
	read(c: Cursor): string {
		const [s, e, _] = c.ordered()
		return this.e.value.substring(s, e)
	}

	// Search finds the next occurrence of lastSearch/lastSearchRegexp and selects it
	// and scrolls to it.
	//
	// The first character determines the kind of search. If slash, the remainder is
	// interpreted as regular expression. If space (and currently anything else), the
	// remainder is interpreted as a literal string.
	search(reverse: boolean): boolean {
		if (!this.lastSearch) {
			return false
		}
		const t = this.lastSearch.substring(1)
		if (this.lastSearch.charAt(0) !== '/') {
			return this.searchText(t, reverse)
		}
		if (t !== this.lastSearchRegexpString || !this.lastSearchRegexp) {
			this.lastSearchRegexp = new RegExp(t, 'v')
			this.lastSearchRegexpString = t
		}
		return this.searchRegexp(this.lastSearchRegexp, reverse)
	}

	searchText(t: string, reverse: boolean): boolean {
		if (reverse) {
			return this.searchTextReverse(t)
		}

		const after = this.read(new Cursor(this.cursor.cur+1, this.e.value.length))
		let i = after.indexOf(t)
		if (i >= 0) {
			this.setCursor(this.cursor.cur+1+i)
			return true
		}
		const before = this.read(new Cursor(0, this.cursor.cur))
		i = before.indexOf(t)
		if (i >= 0) {
			this.setCursor(i)
			return true
		}
		return false
	}

	searchTextReverse(t: string) {
		const before = this.read(new Cursor(0, this.cursor.cur))
		let i = before.lastIndexOf(t)
		if (i >= 0) {
			this.setCursor(i)
			return true
		}
		const after = this.read(new Cursor(this.cursor.cur+1, this.e.value.length))
		i = after.lastIndexOf(t)
		if (i >= 0) {
			this.setCursor(this.cursor.cur+1+i)
			return true
		}
		return false
	}

	searchRegexp(re: RegExp, reverse: boolean): boolean {
		// todo: not implemented yet, code cannot be reached
		log('searchRegexp', re, reverse)
		return false
	}

	// Indent text covered by cursor.
	indent(c: Cursor): number {
		const t = this.read(c)
		let r = ''
		if (t.length >= 1 && t.charAt(0) !== '\n') {
			r += '\t'
		}
		let i = 0
		for (let ch of t) {
			r += ch
			if (ch === '\n') {
				if (i+1 < t.length && t.charAt(i+1) !== '\n') {
					r += '\t'
				}
			}
			i++
		}
		this.replace(c, r, false)
		return r.length
	}

	// Unindent text covered by cursor.
	unindent(c: Cursor): number {
		const t = this.read(c)
		let nt = t.replace(/\n\t/g, '\n')
		if (nt.length > 0 && nt.charAt(0) === '\t') {
			nt = nt.substring(1)
		}
		this.replace(c, nt, false)
		return nt.length
	}

	// close history item and set last text used in a command (e.g. newly typed, or
	// replacement text).
	closeHist() {
		this.histOpen = false
		this.lastKnownValue = this.e.value
		if (this.needLastCommandText) {
			this.needLastCommandText = false
			if (this.history.length > 0) {
				this.lastCommandText = this.history[this.history.length-1].nbuf
			}
		}
	}

	// Check if current text is different from last known. If so, insert mode has made
	// changes. We add the changes to the history so we can undo and repeat.
	histAfterInsert() {
		let o = this.lastKnownValue
		let n = this.e.value
		if (o === n) {
			return
		}
		let s = 0
		while(s < o.length && s < n.length && o.charAt(s) === n.charAt(s)) {
			s++
		}
		let oe = o.length
		let ne = n.length
		while (oe > s && ne > s && o.charAt(oe-1) === n.charAt(ne-1)) {
			oe--
			ne--
		}
		log('found hist', {s, oe, ne, o, n})
		const h = new TextHist(new Cursor(oe, s), o.substring(s, oe), n.substring(s, ne))

		if (!this.histOpen) {
			this.lastCommand = ''
		}
		this.lastCommandText = h.nbuf
		this.histOpen = false
		log('add history after insert mode', h, this.lastKnownValue)
		this.history.push(h)
		this.future = []
		this.lastKnownValue = this.e.value
	}

	// Replace text at cursor, keeping track of history and updating DOM element. open
	// indicates whether this can be merged into the latest history entry (not used,
	// would be when we control insert mode).
	replace(c: Cursor, text: string, open: boolean): boolean {
		const wasOpen = this.histOpen
		this.histOpen = this.histOpen && open && this.future.length === 0
		if (!wasOpen && !this.histOpen) {
			this.closeHist()
		}

		const modified = this.replaceHist(c, text, true)
		this.histOpen = open
		return modified
	}

	// replaceHist updates the DOM element with text at c, and optionally records the
	// change in history for undo/redo.
	replaceHist(c: Cursor, text: string, recordHist: boolean) {
		log('replaceHist', c, text, recordHist)

		const [s, e, _] = c.ordered()

		if (s === e && !text) {
			return false
		}

		if (recordHist) {
			const obuf = this.read(new Cursor(e, s))
			let recorded = false
			if (this.histOpen && this.history.length > 0) {
				const h = this.history[this.history.length-1]
				log('expanding last history item', h)
				const [c0] = h.c.ordered()
				if (c0 + h.nbuf.length === s) {
					h.nbuf += text
					recorded = true
				}
			}
			if (!recorded) {
				const h = new TextHist(c, obuf, text)
				log('adding new history item', h)
				this.history.push(h)
			}
			this.future = []
		}

		this.e.setRangeText(text, s, e, 'select')
		this.lastKnownValue = this.e.value
		log('lastKnownValue now', this.lastKnownValue)
		return true
	}

	// undo the latest change, recording it in the redo buffer.
	undo() {
		const h = this.history.pop()
		if (!h) {
			return
		}
		log('undoing', h)

		// Prepare new last known value, applying change in reverse.
		let last = this.lastKnownValue
		const [hs] = h.c.ordered()
		last = last.substring(0, hs) + h.obuf + last.substring(hs+h.nbuf.length)

		this.future.push(h)
		this.closeHist()
		const [c0] = h.c.ordered()
		const c1 = c0 + h.nbuf.length
		this.replaceHist(new Cursor(c0, c1), h.obuf, false)
		this.lastKnownValue = last // replaceHist has set lastKnownValue too
		log('lastKnownValue after undo', last)
		this.histOpen = false
		const c = c0 + h.obuf.length
		this.setCursor(c)
	}

	// redo the last undone change, storing the change in the history again.
	redo() {
		const h = this.future.pop()
		if (!h) {
			return
		}
		log('redoing', h)
		this.history.push(h)
		this.closeHist()
		this.replaceHist(h.c, h.nbuf, false)
		this.histOpen = false
		const c = h.c.start + h.nbuf.length
		this.setCursor(c)
	}

	// key handles key pressed, some non-vi key combo's are handled first, then keys
	// are handled as vi commands/movements.
	async key(xe: Event) {
		const e = xe as KeyboardEvent
		log('vi key', xe)

		if (e.key === 'Tab') {
			// Pass on to browser to change focus.
			this.off()
			return
		}

		xe.preventDefault()
		xe.stopPropagation()

		if (e.key === 'd' && e.ctrlKey) {
			debug = !debug
			log('debug now', debug)
			return
		}
		if (e.key === 'h' && e.ctrlKey) {
			log('history')
			for (const h of this.history) { log(JSON.stringify(h)) }
			log('future')
			for (const h of this.future) { log(JSON.stringify(h)) }
			log('histOpen', this.histOpen)
			log('lastKnownValue', this.lastKnownValue)
			log('last', {cmd: this.lastCommand, text: this.lastCommandText, need: this.needLastCommandText})
			return
		}

		if (e.key === 'Escape' || e.ctrlKey && e.key === '{') {
			this.setMode('command')
			this.setCursor(this.cursor.cur)
			this.commandStr = ''
			this.visualStr = ''
			return
		}

		// todo: only handle actual keys, not shift/ctrl/etc.
		if (e.key.length !== 1 || e.isComposing) {
			return
		}

		// todo: try to unify command & visual handling.

		try {
			if (this.mode === 'command') {
				this.commandStr += e.key
				await this.command(e.ctrlKey)
			} else {
				this.visualStr += e.key
				await this.visual(e.ctrlKey)
			}
		} catch (e) {
			if (e instanceof IncompleteError) {
				if (this.mode === 'command') {
					log('command incomplete', this.commandStr)
				} else {
					log('visual incomplete', this.visualStr)
				}
				// Need to wait for more of the command.
			} else if (e instanceof BadNumberError || e instanceof BadMoveError || e instanceof NoNumberError || e instanceof BadCommandError) {
				if (this.mode === 'command') {
					log('invalid command, resetting', this.commandStr)
					this.commandStr = ''
				} else {
					log('invalid visual, resetting', this.visualStr)
					this.visualStr = ''
				}
				log('bad command', e)
			} else {
				throw e
			}
		}
	}

	// command attempts to execute a command from the command buffer, throwing an error
	// on incomplete and invalid commands.
	async command(ctrl: boolean) {
		let cmd = new Cmd(this.commandStr)
		const fr = new Reader(this.cursor.cur, true, this.e.value)
		const br = new Reader(this.cursor.cur, false, this.e.value)

		let modified = false

		// todo: include ctrl in all switch cases. we now ignore ctrl most of the times. will cause confusion.

		cmd.number()
		const k = cmd.get()
		switch (k) {
		case 'i':
		{
			this.off()
			break
		}
		case 'I':
		{
			br.line(false)
			this.setCursor(br.offset())
			this.off()
			break
		}
		case 'a':
		{
			fr.get()
			this.setCursor(fr.offset())
			this.off()
			break
		}
		case 'A':
		{
			fr.line(false)
			this.setCursor(fr.offset())
			this.off()
			break
		}
		case 'o':
		{
			fr.line(true)
			modified = this.replace(new Cursor(fr.offset(), fr.offset()), '\n', false)
			this.setCursor(fr.offset())
			this.off()
			break
		}
		case 'O':
		{
			br.line(false)
			modified = this.replace(new Cursor(br.offset(), br.offset()), '\n', false)
			this.setCursor(br.offset())
			this.off()
			break
		}
		case 's':
		{
			cmd.times(() => fr.get())
			modified = this.replace(new Cursor(br.offset(), fr.offset()), '', false)
			this.setCursor(fr.offset())
			this.off()
			break
		}
		case 'S':
		{
			cmd.times(() => fr.line(true))
			modified = this.replace(new Cursor(br.offset(), fr.offset()), "\n", false)
			this.setCursor(fr.offset())
			this.off()
			break
		}
		// case 'R': // replace, not sure if this is a useful enough
		case 'D':
		{
			// delete lines
			cmd.times(() => fr.line(true))
			modified = this.replace(new Cursor(this.cursor.cur, fr.offset()), "\n", false)
			break
		}
		case 'd':
		{
			if (ctrl) {
				this.e.scrollBy(0, this.e.scrollHeight/2)
				break
			}
			// delete movement
			cmd.number()
			const c = new Cursor(this.cursor.cur, this.move(cmd, br, fr, 'd'))
			modified = this.replace(c, '', false)
			this.setCursor(br.offset())
			break
		}
		case 'C':
		{
			// replace lines
			let o = -1
			for (let i = 0; i < cmd.num; i++) {
				fr.line(false)
				const c = fr.get()
				if (!c) {
					break
				}
				if (i === cmd.num-1) {
					o = fr.offset()-1
				}
			}
			if (o < 0) {
				o = fr.offset()
			}
			modified = this.replace(new Cursor(this.cursor.cur, o), "", false)
			this.off()
			break
		}
		case 'c':
		{
			// replace movement
			cmd.number()
			const c = new Cursor(this.cursor.cur, this.move(cmd, br, fr, 'c'))
			modified = this.replace(c, '', false)
			this.off()
			break
		}
		case 'x':
		{
			// delete
			cmd.times(() => fr.get())
			modified = this.replace(new Cursor(this.cursor.cur, fr.offset()), '', false)
			break
		}
		case 'X':
		{
			// backspace
			cmd.times(() => br.get())
			modified = this.replace(new Cursor(br.offset(), this.cursor.cur), '', false)
			this.setCursor(br.offset())
			break
		}
		case 'y':
		{
			if (ctrl) {
				// viewport lines up, we can't tell if cursor is visible, so we don't try to update.
				this.e.scrollBy(0, -cmd.num*lineheight)
				break
			}

			// yank
			cmd.number()
			const c = new Cursor(this.cursor.cur, this.move(cmd, br, fr, 'y'))
			const s = this.read(c)
			try {
				await clipboardWriteText(s)
			} catch (err: any) {
				alert('writing to clipboard: '+(err.message || '(no details)'))
			}
			break
		}
		case 'Y':
		{
			// whole lines
			br.line(false)
			cmd.times(() => fr.line(true))
			const s = this.read(new Cursor(br.offset(), fr.offset()))
			try {
				await clipboardWriteText(s)
			} catch (err: any) {
				alert('writing to clipboard: '+(err.message || '(no details)'))
			}
			break
		}
		case 'p':
		{
			// paste
			let s = ''
			try {
				s = await clipboardReadText()
			} catch (err: any) {
				alert('reading from clipboard: '+(err.message || '(no details)'))
				break
			}
			modified = this.replace(this.cursor, s, false)
			this.setCursor(this.cursor.cur+1)
			break
		}
		case 'P':
		{
			// paste before
			let s = ''
			try {
				s = await clipboardReadText()
			} catch (err: any) {
				alert('reading from clipboard: '+(err.message || '(no details)'))
				break
			}
			br.get()
			modified = this.replace(new Cursor(br.offset(), br.offset()), s, false)
			this.setCursor(br.offset())
			break
		}
		case '<':
		{
			// unindent
			cmd.number()
			br.line(false)
			const c = new Cursor(this.cursor.cur, this.move(cmd, br, fr, '<'))
			this.unindent(c)
			this.setCursor(br.offset())
			modified = true
			break
		}
		case '>':
		{
			// indent
			cmd.number()
			br.line(false)
			const c = new Cursor(this.cursor.cur, this.move(cmd, br, fr, '>'))
			this.indent(c)
			this.setCursor(br.offset())
			modified = true
			break
		}
		case 'J':
		{
			// join with next line
			fr.line(false)
			const o = fr.offset()
			fr.get()
			if (o !== fr.offset()) {
				modified = this.replace(new Cursor(o, fr.offset()), " ", false)
			}
			break
		}
		case '~':
		{
			// swap case of single char
			const start = fr.offset()
			let r = fr.get()
			if (r) {
				const or = r
				const lower = r.toLowerCase()
				const upper = r.toUpperCase()
				if (r === upper) {
					r = lower
				} else if (r === lower) {
					r = upper
				}
				if (or !== r) {
					modified = this.replace(new Cursor(start, fr.offset()), r, false)
					this.setCursor(start + r.length)
				}
			}
			break
		}
		case 'v':
		{
			this.setMode('visual')
			break
		}
		case 'V':
		{
			br.line(false)
			fr.line(false)
			this.cursor = new Cursor(fr.offset(), br.offset())
			this.e.setSelectionRange(...this.cursor.ordered())
			this.setMode('visualline')
			break
		}
		case 'e':
		{
			if (ctrl) {
				// viewport lines down, we can't tell if cursor is visible, so we don't try to update.
				this.e.scrollBy(0, cmd.num*lineheight)
			}
			break
		}
		case '*':
		{
			br.nonwhitespacepunct()
			fr.nonwhitespacepunct()
			const s = this.read(new Cursor(br.offset(), fr.offset()))
			this.lastSearch = " " + s
			this.search(false)
			break
		}
		case '#':
		{
			br.nonwhitespacepunct()
			fr.nonwhitespacepunct()
			const s = this.read(new Cursor(br.offset(), fr.offset()))
			this.lastSearch = " " + s
			this.search(true)
			break
		}
		case 'n':
		{
			this.search(false)
			break
		}
		case 'N':
		{
			this.search(true)
			break
		}
		case '.':
		{
			const [lastCmd, lastText] = [this.lastCommand, this.lastCommandText]
			log('repeat', lastCmd, lastText)
			if (!lastCmd && lastText) {
				// Just an insert.
				this.replace(new Cursor(this.cursor.cur, this.cursor.cur), lastText, false)
				this.setCursor(this.cursor.cur+lastText.length)
				break
			}
			// todo: improve this, repeating the command should leave the history-change open, and our call to replace should update it.
			this.commandStr = lastCmd
			try {
				this.command(false)
				if (lastText) {
					this.replace(new Cursor(this.cursor.cur, this.cursor.cur), lastText, false)
				}
				this.mode = 'command'
			} finally {
				this.lastCommand = lastCmd
				this.lastCommandText = lastText
				this.commandStr = ''
			}
			return
		}
		case 'u':
		{
			this.undo()
			break
		}
		case 'r':
		{
			if (ctrl) {
				this.redo()
				break
			}
			throw new BadCommandError('unrecognized')
		}
		case 'f':
		{
			if (ctrl) {
				this.e.scrollBy(0, this.e.scrollHeight)
				break
			}
			throw new BadCommandError('unrecognized')
		}
		case 'g':
		{
			if (ctrl) {
				// todo: show location somewhere
				throw new BadCommandError('unrecognized')
			}

			const c = cmd.get()
			switch (c) {
			case 'q':
			{
				cmd.number()
				const o = this.move(cmd, br, fr, 'q')
				br.line(false)
				const c = new Cursor(o, br.offset())
				const text = wrap(this.read(c))
				modified = this.replace(c, text, false)
				const nbr = new Reader(c.start+text.length, false, this.e.value)
				nbr.line(false)
				this.setCursor(nbr.offset())
				break
			}
			default:
				throw new BadCommandError('unrecognized')
			}
			break
		}

		default:
			// todo: find a better place to do this, or a better place to handle moves.
			if (k === 'b' && ctrl) {
				this.e.scrollBy(0, -this.e.scrollHeight)
				break
			}

			cmd = new Cmd(this.commandStr)
			cmd.number()
			const ncur = this.move(cmd, br, fr, '')
			this.setCursor(ncur)
		}

		if (modified) {
			this.lastCommand = this.commandStr
			this.lastCommandText = ''
			this.needLastCommandText = this.mode === 'insert'
		}
		log('command completed', this.commandStr)
		this.commandStr = ''
	}

	// visual is like command but for visual and visualline modes.
	async visual(ctrl: boolean) {
		const line = this.mode === 'visualline'
		let cmd = new Cmd(this.visualStr)
		const fr = new Reader(this.cursor.cur, true, this.e.value)
		const br = new Reader(this.cursor.cur, false, this.e.value)

		let modified = false

		const [c0] = this.cursor.ordered()

		const k = cmd.get()
		switch (k) {
		case 'i':
		{
			this.off()
			break
		}
		case 'v':
		{
			this.setMode('visual')
			return
		}
		case 'V':
		{
			br.line(false)
			fr.line(false)
			this.cursor = new Cursor(fr.offset(), br.offset())
			this.e.setSelectionRange(...this.cursor.ordered())
			this.setMode('visualline')
			return
		}
		case 'd':
		{
			modified = this.replace(this.cursor, '', false)
			this.cursor = new Cursor(c0, c0)
			break
		}
		case 's':
		{
			modified = this.replace(this.cursor, '', false)
			this.cursor = new Cursor(c0, c0)
			this.off()
			break
		}
		case 'y':
		{
			const s = this.read(this.cursor)
			try {
				await clipboardWriteText(s)
			} catch (err: any) {
				alert('writing to clipboard: '+(err.message || '(no details)'))
			}
			break
		}
		case 'p':
		{
			let s = ''
			try {
				s = await clipboardReadText()
			} catch (err: any) {
				alert('reading from clipboard: '+(err.message || '(no details)'))
				break
			}
			modified = this.replace(this.cursor, s, false)
			this.cursor = new Cursor(c0 + s.length, c0)
			break
		}
		case 'e':
		{
			if (ctrl) {
				// viewport lines down, we can't tell if cursor is visible, so we don't try to update.
				this.e.scrollBy(0, cmd.num*lineheight)
				return
			}
			throw new BadCommandError('unknown key')
		}
		case '<':
		{
			const n = this.unindent(this.cursor)
			this.cursor = new Cursor(c0 + n, c0)
			break
		}
		case '>':
		{
			const n = this.indent(this.cursor)
			this.cursor = new Cursor(c0 + n, c0)
			break
		}
		case 'J':
		{
			let s = this.read(this.cursor)
			const newline = s && s.charAt(s.length-1) === '\n'
			if (newline) {
				s = s.substring(0, s.length-1)
			}
			s = s.replace(/\n/g, ' ')
			if (newline) {
				s += '\n'
			}
			this.replace(this.cursor, s, false)
			this.cursor = new Cursor(c0 + s.length, c0)
			break
		}
		case '~':
		{
			let s = ""
			const buf = this.read(this.cursor)
			for (let r of buf) {
				const lower = r.toLowerCase()
				const upper = r.toUpperCase()
				if (r === upper) {
					r = lower
				} else if (r === lower) {
					r = upper
				}
				s += r
			}
			this.replace(this.cursor, s, false)
			this.cursor = new Cursor(c0 + s.length, c0)
			break
		}
		case 'o':
		{
			// Swap direction.
			this.cursor = new Cursor(this.cursor.start, this.cursor.cur)
			this.e.setSelectionRange(...this.cursor.ordered())
			return
		}
		case 'g':
		{
			const kk = cmd.get()
			switch (kk) {
			case 'q':
			{
				const text = wrap(this.read(this.cursor))
				modified = this.replace(this.cursor, text, false)
				const nbr = new Reader(this.cursor.start+text.length, false, this.e.value)
				nbr.line(false)
				this.setCursor(nbr.offset())
				break
			}
			default:
				throw new BadCommandError('unknown key')
			}
			break
		}
		default:
			cmd = new Cmd(this.visualStr)
			cmd.number()
			const offset = this.move(cmd, br, fr, '')
			log('visual move, offset', offset, this.cursor)
			if (line) {
				const swapDirection = (this.cursor.cur > this.cursor.start) !== (offset > this.cursor.start)
				const origCur = this.cursor.cur
				const r = new Reader(offset, offset > this.cursor.start, this.e.value)
				r.line(false)
				this.cursor.cur = r.offset()
				if (swapDirection) {
					this.cursor.start = origCur
				}
				log('cursor now', this.cursor.ordered())
			} else {
				this.cursor.cur = offset
			}

			this.e.setSelectionRange(...this.cursor.ordered())
			this.visualStr = ''
			return
		}

		if (modified) {} // Unused.

		this.setMode('command')
	}
}

// viSelectOn enables basic key handling on a select element.
// Vi key handling is basic: we don't get key events when the select is open
// with options visible (at least on linux x11).
const viSelectOn = (elem: HTMLSelectElement) => {
	const xelem = elem as any
	if (xelem._viEditingModeSelect) {
		return
	}

	log('viSelectOn', elem)
	const state = {
		origBoxShadow: elem.style.boxShadow
	}
	elem.style.boxShadow = '0 0 4px 2px #2190f2'
	xelem._viEditingModeSelect = state

	// todo: figure out why keyboard events no longer fire when select is open with options visible (on linux x11). we don't get a blur event either, but it feels like the focus is out of the document.

	const keydown = (xe: Event) => {
		const ev = xe as KeyboardEvent
		log('select keydown', xe)
		if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) {
			return
		}

		if (elem.options.length === 0) {
			return
		}

		// todo: handle shift to extend selection in case of multiselect. and ctrl to only move focus, not change selection.

		const select = (i: number) => {
			if (i >= 0 && i < elem.options.length) {
				elem.selectedIndex = i
			}
		}

		switch (ev.key) {
		case 'j':
			// Down.
			select(elem.selectedIndex+1)
			break
		case 'k':
			// Up.
			select(elem.selectedIndex-1)
			break
		case '0':
			// First.
			select(0)
			break
		case '$':
			// Last.
			select(elem.options.length-1)
			break
		default:
			return
		}
		ev.preventDefault()
		ev.stopPropagation()
	}

	const unregister = () => {
		log('unregister select')
		elem.removeEventListener('blur', unregister)
		elem.removeEventListener('keydown', keydown)
		elem.style.boxShadow = state.origBoxShadow
		delete xelem._viEditingModeSelect
	}

	elem.addEventListener('blur', unregister)
	elem.addEventListener('keydown', keydown)
}

// viOn initializes an Edit object on an HTML element (if first time), and turns
// command mode on.
const viOn = (t: HTMLTextAreaElement | HTMLInputElement) => {
	log('viOn', t)
	let e: Edit
	const xt = t as any
	if (xt._viEditingModeEdit) {
		if (xt._viEditingModeEdit instanceof Edit) {
			e = xt._viEditingModeEdit
		} else {
			return
		}
	} else {
		e = new Edit(t)
		xt._viEditingModeEdit = e
	}
	e.on()
}

// Register a document-level key handler for Escape and ctrl-{, to enable vi mode
// on textarea/input/select elements.
document.addEventListener('keydown', function(e) {
	log('document', e)
	if (!(e.key === 'Escape' || e.ctrlKey && e.key === '{')) {
		return
	}
	const t = e.target
	if (t instanceof HTMLTextAreaElement) {
		viOn(t)
	} else if (t instanceof HTMLInputElement) {
		// See setSelectionRange in table https://html.spec.whatwg.org/multipage/input.html#input-type-attr-summary
		const ok = ['text', 'search', 'tel', 'url', 'password']
		if (ok.includes(t.type)) {
			viOn(t)
		}
	} else if (t instanceof HTMLSelectElement) {
		viSelectOn(t)
	}
})

})()
