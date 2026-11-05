import { resolve } from 'node:path';

/** Externalize the resolved source, independently of the importer's relative spelling. */
export function deploymentPlugin(source = resolve('lib/deployment.ts')) {
  return {
    name: 'deployment-config',
    setup(build) {
      build.onResolve({ filter: /deployment(?:\.[cm]?[jt]s)?$/ }, async (args) => {
        if (args.kind === 'entry-point' || args.pluginData?.deploymentResolved) return;
        const resolved = await build.resolve(args.path, {
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { deploymentResolved: true },
        });
        if (resolved.path === source) return { path: './deployment.js', external: true };
      });
    },
  };
}
