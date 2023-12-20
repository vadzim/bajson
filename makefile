.PHONY: preversion

BUILD_DIR=/tmp/bajson_build

preversion:
	node --version

	npm run lint
	npm run test

	rm -rf "${BUILD_DIR}"
	mkdir -p "${BUILD_DIR}"

	npm pack --pack-destination "${BUILD_DIR}"

	tar -zxvf "${BUILD_DIR}"/bajson* -C "${BUILD_DIR}"

	node -e "import('${BUILD_DIR}/package/index.js')"
	node -e "import('${BUILD_DIR}/package/index.cjs')"

postversion:
	 rm -rf "${BUILD_DIR}"
