require('./runtime-runner.cjs').main(process.argv.slice(2)).catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
