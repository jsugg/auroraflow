.PHONY: tools verify smoke observability-smoke

tools:
	npm run verify:tools

verify:
	npm run verify

smoke:
	npm run test:smoke

observability-smoke:
	npm run observability:smoke
