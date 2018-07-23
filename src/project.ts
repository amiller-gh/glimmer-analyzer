import fs = require('fs');
import path = require('path');
import Debug = require('debug');

import { buildResolutionMap } from '@glimmer/resolution-map-builder';
import Resolver, { BasicModuleRegistry, ResolverConfiguration } from '@glimmer/resolver';
import { Dict, assert } from '@glimmer/util';

import loadPackageJSON, { PackageJSON } from './utils/load-package-json';
import loadConfigFactory, { Config } from './utils/load-config-factory';
import buildResolverConfig from './utils/build-resolver-config';

const debug = Debug('glimmer-analyzer:project');

export interface ResolutionMap {
  [specifier: string]: string;
}

export class Template {
  string: string;
  specifier: string;
  path: string;

  constructor(templateString: string, specifier: string, path: string) {
    this.string = templateString;
    this.specifier = specifier;
    this.path = path;
  }
}

export interface ProjectPaths {
  config: string;
  src: string;
  pjson: string;
}

export interface ProjectOptions {
  environment?: string;
  paths?: Partial<ProjectPaths>;
  config?: Config;
}

const DEFAULT_PATHS = {
  src: 'src',
  config: 'config',
  pjson: '.',
};

export default class Project {
  environment: string;
  pkg: PackageJSON;
  paths: ProjectPaths;
  config: Config;
  resolverConfig: ResolverConfiguration;

  protected _map: ResolutionMap;
  protected _resolver: Resolver;
  protected _registry: BasicModuleRegistry;
  protected _pathMap: Dict<string>;

  constructor(public projectDir: string, options: ProjectOptions = {}) {
    this.paths = Object.assign({}, DEFAULT_PATHS, options.paths);
    this.environment = options.environment || 'development';

    debug(`creating project; dir=%s; env=%s; paths=%o`, projectDir, this.environment, this.paths);

    this.loadPackageJSON(projectDir);

    if (options.config) {
      this.config = options.config;
    }
    else {
      this.loadEnvironmentConfig(projectDir, this.environment);
    }

    this.buildResolverConfig();
  }

  get map(): ResolutionMap {
    if (this._map) { return this._map; }

    let { resolverConfig: moduleConfig, projectDir } = this;
    let modulePrefix = moduleConfig.app && moduleConfig.app.rootName || 'app';
    let map = buildResolutionMap({
      projectDir,
      moduleConfig,
      modulePrefix,
      srcDir: this.paths.src
    });

    return this._map = map;
  }

  get pathMap() {
    if (this._pathMap) { return this._pathMap; }

    let map = this.map;
    let pathMap: Dict<string> = {};
    for (let key in map) {
      pathMap[map[key]] = key;
    }

    return this._pathMap = pathMap;
  }

  get resolver(): Resolver {
    if (this._resolver) { return this._resolver; }
    return this._resolver = new Resolver(this.resolverConfig, this.registry);
  }

  get registry(): BasicModuleRegistry {
    if (this._registry) { return this._registry; }
    return this._registry = new BasicModuleRegistry(this.map);
  }

  templateFor(templateName: string) {
    let specifier = this.resolver.identify(`template:${templateName}`);

    if (!specifier) {
      throw new Error(`Couldn't find template for component ${templateName} in Glimmer app ${this.projectDir}.`)
    }

    let templatePath = this.resolver.resolve(specifier);
    let templateString = fs.readFileSync(path.join(this.projectDir, this.paths.src, templatePath), 'utf8');

    return new Template(templateString, specifier, templatePath);
  }

  specifierForPath(objectPath: string): string | null {
    return this.pathMap[objectPath] || null;
  }

  pathForSpecifier(specifier: string): string | null {
    return this.map[specifier] || null;
  }

  protected loadPackageJSON(projectDir: string) {
    let pkgPath = path.join(projectDir, this.paths.pjson, 'package.json');
    let pkg: PackageJSON = loadPackageJSON(pkgPath);

    this.pkg = pkg;

    assert(pkg.name as string, `The package.json at ${pkgPath} did not contain a valid 'name' field.`);
    debug('loaded package.json; path=%s', pkgPath);
  }

  protected loadEnvironmentConfig(projectDir: string, environment: string) {
    let configPath = path.join(projectDir, this.paths.config, 'environment');
    let configFactory = loadConfigFactory(configPath);

    if (configFactory) {
      this.config = configFactory(environment);
      debug('evaluated project config; path=%s; config=%o', configPath, this.config);
    } else {
      debug('no project config found; falling back to defaults');
      this.config = {};
    }
  }

  protected buildResolverConfig() {
    this.resolverConfig = buildResolverConfig(this.config, this.pkg.name);
  }
}
