// node scripts/syncCompanyPermissions.cjs [--check]
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const scope = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/utils/companyPermissions.js'), 'utf8').replace(/export /g, '') + ';globalThis.permissions=companyPermissions;', scope);
const ids = scope.permissions.map(p => p.id);
if (new Set(ids).size !== ids.length) throw Error('Duplicate permission IDs.');
const swiftString = value => JSON.stringify(value).replace(/\$\{/g, '${');
const file = path.resolve(root, '../DripDropIOS/DripDrop/Modules/Roles/Logic/PermissionViewModel.swift');
const before = fs.readFileSync(file, 'utf8');
const start = before.indexOf('    @Published private(set) var standrdPermissions:');
const end = before.indexOf('    func getPermissionsByIdList', start);
const rows = scope.permissions.map(p => `        PermissionModel(id: ${swiftString(p.id)}, name: ${swiftString(p.name)}, description: ${swiftString(p.description)}, category: ${swiftString(p.category)}),`).join('\n');
let result = before.slice(0, start) + `    @Published private(set) var standrdPermissions: [PermissionModel] = [\n${rows}\n    ]\n    var permissionIds: [String] { standrdPermissions.map(\\.id) }\n` + before.slice(end);
const seeds = require('../functions/companyRoleSeeds');
const enumStart = result.indexOf('enum DefaultCompanyRolePermissions {'), enumEnd = result.indexOf('\n@MainActor', enumStart);
const cases = ['Owner','Tech','Manager','Admin','Office'].map(name => `        case ${swiftString(name)}: return ${JSON.stringify(seeds.seedPermissions(name))}`).join('\n');
result = result.slice(0, enumStart) + `enum DefaultCompanyRolePermissions {\n    static func ids(for name: String) -> [String] {\n        switch name {\n${cases}\n        default: return []\n        }\n    }\n}\n` + result.slice(enumEnd);
if (process.argv.includes('--check')) {
  if (result !== before) throw Error('Native permission catalog or seeds are stale. Run this script without --check.');
} else fs.writeFileSync(file, result);
console.log(`${ids.length} company permissions and five role seeds agree across web, backend, and iOS.`);
