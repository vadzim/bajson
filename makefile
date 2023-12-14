.PHONY: preversion

preversion:
	npm run lint
	npm run test
	rm -rf /tmp/bajson_build
	mkdir -p /tmp/bajson_build
	npm pack --pack-destination /tmp/bajson_build
	tar -zxvf /tmp/bajson_build/bajson* -C /tmp/bajson_build/
	node -e 'import(`/tmp/bajson_build/package/index.js`)'
	node -e 'import(`/tmp/bajson_build/package/index.cjs`)'
