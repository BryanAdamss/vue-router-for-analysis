var spawn = require('cross-spawn')
var args = process.argv.slice(2)

var server = args.indexOf('--dev') > -1
  ? null
  : require('../../examples/server')

if (args.indexOf('--config') === -1) {
  args = args.concat(['--config', 'test/e2e/nightwatch.config.js'])
}
if (args.indexOf('--env') === -1) {
  args = args.concat(['--env', 'phantomjs'])
}
var i = args.indexOf('--test')
if (i > -1) {
  args[i + 1] = 'test/e2e/specs/' + args[i + 1].replace(/\.js$/, '') + '.js'
}
if (args.indexOf('phantomjs') > -1) {
  process.env.PHANTOMJS = true
}

// TODO: update while updating nightwatch
// https://github.com/nightwatchjs/nightwatch/releases?after=v1.0.2
var runner = spawn('./node_modules/.bin/nightwatch', args, {
  stdio: 'inherit'
})

runner.on('exit', function (code) {
  server && server.close()
  process.exit(code)
})

runner.on('error', function (err) {
  server && server.close()
  throw err
})
