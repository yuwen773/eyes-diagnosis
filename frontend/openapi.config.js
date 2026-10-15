import { generateService } from '@umijs/openapi'
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// These adapters have public signatures/return conventions that codegen cannot
// reproduce. Generate separately: @umijs/openapi deletes its output directory.
const adapters = new Set([
  'knowledgeController.ts', 'mcpController.ts', 'workflowController.ts',
  'reviewController.ts', 'supplementController.ts', 'toolConfirmationController.ts',
])
const apiDir = new URL('./src/api/', import.meta.url)
const overrides = await readFile(new URL('./openapi/overrides.ts', import.meta.url), 'utf8')
const signatures = [...overrides.matchAll(/^export async function (\w+)\([\s\S]*?^}/gm)]
const temporary = await mkdtemp(join(tmpdir(), 'eye-python-openapi-'))
try {
  await generateService({
    requestLibPath: "import request from '@/request'",
    schemaPath: process.env.OPENAPI_SCHEMA_URL || 'http://localhost:8080/api/openapi.json',
    serversPath: temporary,
    projectName: 'api',
    hook: {
      afterOpenApiDataInited(schema) {
        // Axios already supplies /api. Preserve the existing controller URLs.
        schema.paths = Object.fromEntries(Object.entries(schema.paths)
          .map(([path, operations]) => [path.replace(/^\/api/, ''), operations]))
        const names = {
          BaseResponse_bool_: 'BaseResponseBoolean',
          BaseResponse_str_: 'BaseResponseString',
          BaseResponse_Annotated_int__PlainSerializer__: 'BaseResponseLong',
        }
        for (const name of Object.keys(schema.components.schemas)) {
          if (/^(BaseResponse|PageResult)_/.test(name) && !names[name]) {
            names[name] = name.replace('PageResult', 'Page').replaceAll('_', '')
          }
        }
        schema = JSON.parse(JSON.stringify(schema).replace(
          /#\/components\/schemas\/([^"\s]+)/g,
          (_, name) => '#/components/schemas/' + (names[name] || name),
        ))
        schema.components.schemas = Object.fromEntries(Object.entries(schema.components.schemas)
          .map(([name, model]) => [names[name] || name, model]))
        // Preserve the legacy TypeScript surface, including its optional/null
        // convention and numeric Long declarations. Actual wire Longs are
        // strings; correcting consumer types belongs to a separate UI change.
        function compatible(node) {
          if (!node || typeof node !== 'object') return
          delete node.required
          if (node.anyOf) node.anyOf = node.anyOf.filter(item => item.type !== 'null')
          for (const value of Object.values(node)) compatible(value)
        }
        compatible(schema.components.schemas)
        for (const [name, model] of Object.entries(schema.components.schemas)) {
          if (name.endsWith('VO') && model.properties?.id) model.properties.id = { type: 'integer' }
          if (name.startsWith('Page')) {
            for (const key of ['total', 'size', 'current', 'pages']) model.properties[key] = { type: 'integer' }
          }
        }
        schema.components.schemas.DiagnosisResultVO.properties.chunkCount = { type: 'integer' }
        Object.assign(schema.components.schemas.UserEditDTO.properties, {
          id: { type: 'integer' }, gender: { type: 'integer' },
          phone: { type: 'string' }, email: { type: 'string' },
        })
        return schema
      },
    },
  })
  for (const name of await readdir(join(temporary, 'api'))) {
    if (adapters.has(name) || name === 'index.ts') continue
    let content = await readFile(join(temporary, 'api', name), 'utf8')
    for (const [source, functionName] of signatures) {
      content = content.replace(new RegExp(`^export async function ${functionName}\\([\\s\\S]*?^}`, 'm'), source)
    }
    content = content.replace(/^\s*requestType: 'form',\n/gm, '') // Axios infers FormData.
    await writeFile(new URL(name, apiDir), content)
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
