default: vi.js

vi.js: vi.ts tsc.sh node_modules/.bin/tsc
	./tsc.sh vi.js vi.ts

watch:
	bash -c 'while true; do inotifywait -q -e close_write *.ts; make vi.js; done'

zip:
	-mkdir local
	-rm local/vi-editing-mode-$$(git describe --tag).zip
	zip -r local/vi-editing-mode-$$(git describe --tag).zip manifest.json vi.js icons

node_modules/.bin/tsc:
	-mkdir -p node_modules/.bin
	npm ci --ignore-scripts

install-js0:
	-mkdir -p node_modules/.bin
	npm install --ignore-scripts --save-dev --save-exact typescript@5.1.6
