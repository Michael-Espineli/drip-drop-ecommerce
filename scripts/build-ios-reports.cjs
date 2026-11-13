#!/usr/bin/env node
// Run after changes to report calculations, metadata, payroll estimates or exports.
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const webpack = require('webpack');
const root = path.resolve(__dirname, '..');
const destination = path.resolve(root, '../DripDropIOS/DripDrop/Modules/Report/ReportRuntime');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dripdrop-reports-'));
webpack({ context: root, mode: 'production', target: ['web', 'es2020'],
  entry: path.join(root, 'src/utils/reports/nativeReportRuntime.js'),
  output: { path: temporary, filename: 'reports.js', library: { name: 'ReportRuntime', type: 'var' }, globalObject: 'globalThis' },
  optimization: { minimize: true }, performance: false, devtool: false,
}, (error, stats) => {
  if (error || stats.hasErrors()) { console.error(error || stats.toString({ all: false, errors: true })); process.exitCode = 1; return; }
  const bundle = fs.readFileSync(path.join(temporary, 'reports.js'), 'utf8');
  const context = vm.createContext({}); vm.runInContext(bundle, context);
  const catalog = JSON.stringify(JSON.parse(context.ReportRuntime.catalogJSON()), null, 2) + '\n';
  const packages = new Set();
  const visit = (modules = []) => modules.forEach((module) => {
    const match = (module.nameForCondition || module.name || '').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (match) packages.add(match[1]);
    visit(module.modules);
  });
  visit(stats.toJson({ all: false, modules: true, nestedModules: true }).modules);
  const notices = [...packages].sort().map((name) => {
    const directory = path.join(root, 'node_modules', name);
    const info = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    const licenses = fs.readdirSync(directory).filter((file) => /^(licen[cs]e|notice)(\.|$)/i.test(file) && fs.statSync(path.join(directory, file)).isFile());
    return `${name} ${info.version} (${info.license || 'see source notices'})\n${licenses.map((file) => fs.readFileSync(path.join(directory, file), 'utf8')).join('\n')}`;
  }).join('\n\n----------------------------------------\n\n');
  const files = { 'THIRD_PARTY_NOTICES.txt': notices + '\n', 'reports.js': bundle, 'catalog.json': catalog, 'reports.js.LICENSE.txt': fs.readFileSync(path.join(temporary, 'reports.js.LICENSE.txt'), 'utf8') };
  fs.mkdirSync(destination, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(destination, name);
    if (process.argv.includes('--check')) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== contents) { console.error(`Stale iOS report resource: ${name}. Run node scripts/build-ios-reports.cjs.`); process.exitCode = 1; }
    } else fs.writeFileSync(target, contents);
  }
  fs.rmSync(temporary, { recursive: true, force: true });
  console.log(process.exitCode ? 'Report bundle check failed.' : `iOS report bundle ${process.argv.includes('--check') ? 'verified' : 'updated'} (${Buffer.byteLength(bundle)} bytes).`);
});
