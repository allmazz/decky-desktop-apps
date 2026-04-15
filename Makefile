BUILD_DIR = build
PLUGIN_NAME = decky-apps
BUNDLE_ZIP_NAME = $(PLUGIN_NAME).zip

.PHONY: clean build bundle

bundle: build
	mkdir -p $(BUILD_DIR)/$(PLUGIN_NAME)
	cp -r plugin.json package.json README.md LICENSE dist main.py $(BUILD_DIR)/$(PLUGIN_NAME)
	cd $(BUILD_DIR); zip -r $(BUNDLE_ZIP_NAME) $(PLUGIN_NAME)
build:
	pnpm run build

clean:
	rm -rf dist
	rm -rf build
