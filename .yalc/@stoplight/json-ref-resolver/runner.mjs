import { __awaiter } from './_virtual/_tslib.js';
import { trimStart, pointerToPath, pathToPointer, startsWith } from '@stoplight/json';
import { join, dirname, stripRoot, toFSPath } from '@stoplight/path';
import { DepGraph } from 'dependency-graph';
import produce, { original } from 'immer';
import { set, get } from 'lodash-es';
import URI from 'urijs';
import { ExtendedURI } from './uri.mjs';
import { Cache } from './cache.mjs';
import { ResolveCrawler } from './crawler.mjs';
import { uriToJSONPointer } from './utils.mjs';
import memoize from 'fast-memoize';

let resolveRunnerCount = 0;
const defaultGetRef = (key, val) => {
    if (val && typeof val === 'object' && typeof val.$ref === 'string')
        return val.$ref;
    return;
};
class ResolveRunner {
    constructor(source, graph = new DepGraph({ circular: true }), opts = {}) {
        this.ctx = {};
        this.computeRef = (opts) => {
            const refStr = this.getRef(opts.key, opts.val);
            if (refStr === undefined)
                return;
            let ref = new ExtendedURI(refStr);
            if (refStr[0] !== '#') {
                const isFile = this.isFile(ref);
                if (isFile) {
                    let absRef = ref.toString();
                    if (!ref.is('absolute')) {
                        if (this.baseUri.toString()) {
                            absRef = join(dirname(this.baseUri.toString()), stripRoot(absRef));
                        }
                        else {
                            absRef = '';
                        }
                    }
                    if (absRef) {
                        ref = new URI(toFSPath(absRef)).fragment(ref.fragment());
                    }
                }
                else if (ref.scheme().includes('http') || (ref.scheme() === '' && this.baseUri.scheme().includes('http'))) {
                    if (this.baseUri.authority() !== '' && ref.authority() === '') {
                        ref = ref.absoluteTo(this.baseUri);
                    }
                }
            }
            if (this.transformRef) {
                return this.transformRef(Object.assign(Object.assign({}, opts), { ref, uri: this.baseUri }), this.ctx);
            }
            return ref;
        };
        this.atMaxUriDepth = () => {
            return this.uriStack.length >= 100;
        };
        this.lookupUri = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { ref } = opts;
            let scheme = ref.scheme();
            if (!this.resolvers[scheme] && this.isFile(ref)) {
                scheme = 'file';
            }
            const resolver = this.resolvers[scheme];
            if (!resolver) {
                throw new Error(`No resolver defined for scheme '${ref.scheme() || 'file'}' in ref ${ref.toString()}`);
            }
            let result = yield resolver.resolve(ref, this.ctx);
            if (this.parseResolveResult) {
                try {
                    const parsed = yield this.parseResolveResult({
                        uriResult: result,
                        result,
                        targetAuthority: ref,
                        parentAuthority: this.baseUri,
                        parentPath: opts.parentPath,
                        fragment: opts.fragment,
                    });
                    result = parsed.result;
                }
                catch (e) {
                    throw new Error(`Could not parse remote reference response for '${ref.toString()}' - ${String(e)}`);
                }
            }
            return new ResolveRunner(result, this.graph, {
                depth: this.depth + 1,
                baseUri: ref.toString(),
                root: ref,
                uriStack: this.uriStack,
                uriCache: this.uriCache,
                resolvers: this.resolvers,
                transformRef: this.transformRef,
                parseResolveResult: this.parseResolveResult,
                transformDereferenceResult: this.transformDereferenceResult,
                dereferenceRemote: this.dereferenceRemote,
                dereferenceInline: this.dereferenceInline,
                ctx: this.ctx,
            });
        });
        this.lookupAndResolveUri = (opts) => __awaiter(this, void 0, void 0, function* () {
            const { val, ref, resolvingPointer, parentPointer, pointerStack } = opts;
            const parentPath = opts.parentPath ? opts.parentPath.slice() : [];
            const uriCacheKey = this.computeUriCacheKey(ref);
            const lookupResult = {
                uri: ref,
                pointerStack,
                targetPath: resolvingPointer === parentPointer ? [] : parentPath,
            };
            if (this.uriStack.includes(uriCacheKey)) {
                lookupResult.resolved = {
                    result: val,
                    graph: this.graph,
                    refMap: {},
                    errors: [],
                    runner: this,
                };
                return lookupResult;
            }
            else {
                let uriResolver;
                const currentAuthority = this.baseUri.toString();
                const newUriStack = currentAuthority && this.depth !== 0 ? currentAuthority : null;
                try {
                    if (this.atMaxUriDepth()) {
                        throw new Error(`Max uri depth (${this.uriStack.length}) reached. Halting, this is probably a circular loop.`);
                    }
                    uriResolver = yield this.lookupUri({
                        ref: ref.clone().fragment(''),
                        fragment: ref.fragment(),
                        cacheKey: uriCacheKey,
                        parentPath,
                    });
                    if (newUriStack) {
                        uriResolver.uriStack = uriResolver.uriStack.concat(newUriStack);
                    }
                }
                catch (e) {
                    lookupResult.error = {
                        code: 'RESOLVE_URI',
                        message: String(e),
                        uri: ref,
                        uriStack: newUriStack ? this.uriStack.concat(newUriStack) : this.uriStack,
                        pointerStack,
                        path: parentPath,
                    };
                }
                if (uriResolver) {
                    lookupResult.resolved = yield uriResolver.resolve({
                        jsonPointer: uriToJSONPointer(ref),
                        parentPath,
                    });
                    if (lookupResult.resolved.errors.length) {
                        for (const error of lookupResult.resolved.errors) {
                            if (error.code === 'POINTER_MISSING' &&
                                error.path.join('/') === ref.fragment().slice(1)) {
                                const errorPathInResult = ref.fragment
                                    ? trimStart(error.path, trimStart(ref.fragment(), '/').split('/'))
                                    : error.path;
                                if (errorPathInResult && errorPathInResult.length) {
                                    set(lookupResult.resolved.result, errorPathInResult, val);
                                }
                                else if (lookupResult.resolved.result) {
                                    lookupResult.resolved.result = val;
                                }
                            }
                        }
                    }
                }
            }
            return lookupResult;
        });
        this.id = resolveRunnerCount += 1;
        this.depth = opts.depth || 0;
        this._source = source;
        this.resolvers = opts.resolvers || {};
        const baseUri = opts.baseUri || '';
        let uri = new URI(baseUri || '');
        if (this.isFile(uri)) {
            uri = new URI(toFSPath(baseUri));
        }
        this.baseUri = uri;
        this.uriStack = opts.uriStack || [];
        this.uriCache = opts.uriCache || new Cache();
        this.root = (opts.root && opts.root.toString()) || this.baseUri.toString() || 'root';
        this.graph = graph;
        if (!this.graph.hasNode(this.root)) {
            this.graph.addNode(this.root, { refMap: {}, data: this._source });
        }
        if (this.baseUri && this.depth === 0) {
            this.uriCache.set(this.computeUriCacheKey(this.baseUri), this);
        }
        this.getRef = opts.getRef || defaultGetRef;
        this.transformRef = opts.transformRef;
        if (this.depth) {
            this.dereferenceInline = true;
        }
        else {
            this.dereferenceInline = typeof opts.dereferenceInline !== 'undefined' ? opts.dereferenceInline : true;
        }
        this.dereferenceRemote = typeof opts.dereferenceRemote !== 'undefined' ? opts.dereferenceRemote : true;
        this.parseResolveResult = opts.parseResolveResult;
        this.transformDereferenceResult = opts.transformDereferenceResult;
        this.ctx = opts.ctx;
        this.lookupUri = memoize(this.lookupUri, {
            serializer: this._cacheKeySerializer,
            cache: {
                create: () => {
                    return this.uriCache;
                },
            },
        });
    }
    get source() {
        return this._source;
    }
    resolve(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            const resolved = {
                result: this.source,
                graph: this.graph,
                refMap: {},
                errors: [],
                runner: this,
            };
            let targetPath;
            const jsonPointer = opts && opts.jsonPointer && opts.jsonPointer.trim();
            if (jsonPointer && jsonPointer !== '#' && jsonPointer !== '#/') {
                try {
                    targetPath = pointerToPath(jsonPointer);
                }
                catch (_a) {
                    resolved.errors.push({
                        code: 'PARSE_POINTER',
                        message: `'${jsonPointer}' JSON pointer is invalid`,
                        uri: this.baseUri,
                        uriStack: this.uriStack,
                        pointerStack: [],
                        path: [],
                    });
                    return resolved;
                }
                resolved.result = get(resolved.result, targetPath);
            }
            if (resolved.result === void 0) {
                resolved.errors.push({
                    code: 'POINTER_MISSING',
                    message: `'${jsonPointer}' does not exist @ '${this.baseUri.toString()}'`,
                    uri: this.baseUri,
                    uriStack: this.uriStack,
                    pointerStack: [],
                    path: targetPath || [],
                });
                return resolved;
            }
            const crawler = new ResolveCrawler(this, jsonPointer, resolved);
            crawler.computeGraph(resolved.result, targetPath, jsonPointer || '');
            let uriResults = [];
            if (crawler.resolvers.length) {
                uriResults = yield Promise.all(crawler.resolvers);
            }
            if (uriResults.length) {
                for (const r of uriResults) {
                    let resolvedTargetPath = r.targetPath;
                    if (!resolvedTargetPath.length)
                        resolvedTargetPath = targetPath || [];
                    resolved.refMap[String(this.baseUri.clone().fragment(pathToPointer(resolvedTargetPath)))] = String(r.uri);
                    this._setGraphNodeEdge(String(this.root), pathToPointer(resolvedTargetPath), String(r.uri));
                    if (r.error) {
                        resolved.errors.push(r.error);
                    }
                    if (!r.resolved)
                        continue;
                    if (r.resolved.errors) {
                        resolved.errors = resolved.errors.concat(r.resolved.errors);
                    }
                    if (r.resolved.result === void 0)
                        continue;
                    this._source = produce(this._source, (draft) => {
                        if (r.resolved) {
                            if (!resolvedTargetPath.length) {
                                return r.resolved.result;
                            }
                            else {
                                set(draft, resolvedTargetPath, r.resolved.result);
                                this._setGraphNodeData(String(r.uri), r.resolved.result);
                            }
                        }
                    });
                }
            }
            if (typeof this._source === 'object') {
                if (this.dereferenceInline) {
                    this._source = produce(this._source, (draft) => {
                        let processOrder = [];
                        try {
                            processOrder = crawler.pointerGraph.overallOrder();
                            for (const pointer of processOrder) {
                                const dependants = crawler.pointerGraph.dependantsOf(pointer);
                                if (!dependants.length)
                                    continue;
                                const pointerPath = pointerToPath(pointer);
                                const val = pointerPath.length === 0 ? original(draft) : get(draft, pointerPath);
                                for (const dependant of dependants) {
                                    let isCircular;
                                    const dependantPath = pointerToPath(dependant);
                                    const dependantStems = crawler.pointerStemGraph.dependenciesOf(pointer);
                                    for (const stem of dependantStems) {
                                        if (startsWith(dependantPath, pointerToPath(stem))) {
                                            isCircular = true;
                                            break;
                                        }
                                    }
                                    if (isCircular)
                                        continue;
                                    resolved.refMap[pathToPointer(dependantPath)] = pathToPointer(pointerPath);
                                    this._setGraphNodeEdge(this.root, pathToPointer(dependantPath), pathToPointer(pointerPath));
                                    if (val !== void 0) {
                                        set(draft, dependantPath, val);
                                        this._setGraphNodeData(pathToPointer(pointerPath), val);
                                    }
                                    else {
                                        resolved.errors.push({
                                            code: 'POINTER_MISSING',
                                            message: `'${pointer}' does not exist`,
                                            path: dependantPath,
                                            uri: this.baseUri,
                                            uriStack: this.uriStack,
                                            pointerStack: [],
                                        });
                                    }
                                }
                            }
                        }
                        catch (e) {
                        }
                    });
                }
                if (targetPath) {
                    resolved.result = get(this._source, targetPath);
                }
                else {
                    resolved.result = this._source;
                }
            }
            else {
                resolved.result = this._source;
            }
            if (this.transformDereferenceResult) {
                const ref = new URI(jsonPointer || '');
                try {
                    const { result, error } = yield this.transformDereferenceResult({
                        source: this.source,
                        result: resolved.result,
                        targetAuthority: ref,
                        parentAuthority: this.baseUri,
                        parentPath: opts ? opts.parentPath || [] : [],
                        fragment: ref.fragment(),
                    });
                    resolved.result = result;
                    if (error) {
                        throw new Error(`Could not transform dereferenced result for '${ref.toString()}' - ${String(error)}`);
                    }
                }
                catch (e) {
                    resolved.errors.push({
                        code: 'TRANSFORM_DEREFERENCED',
                        message: `Error: Could not transform dereferenced result for '${this.baseUri.toString()}${ref.fragment() !== '' ? `#${ref.fragment()}` : ``}' - ${String(e)}`,
                        uri: ref,
                        uriStack: this.uriStack,
                        pointerStack: [],
                        path: targetPath,
                    });
                }
            }
            this._setGraphNodeData(this.root, this._source);
            return resolved;
        });
    }
    _cacheKeySerializer(sOpts) {
        return sOpts && typeof sOpts === 'object' && sOpts.cacheKey ? sOpts.cacheKey : JSON.stringify(arguments);
    }
    computeUriCacheKey(ref) {
        return ref
            .clone()
            .fragment('')
            .toString();
    }
    isFile(ref) {
        const scheme = ref.scheme();
        if (scheme === 'file')
            return true;
        if (!scheme) {
            if (ref.toString().charAt(0) === '/')
                return true;
            if (this.baseUri) {
                const uriScheme = this.baseUri.scheme();
                return Boolean(!uriScheme || uriScheme === 'file' || !this.resolvers[uriScheme]);
            }
        }
        else if (!this.resolvers[scheme]) {
            return true;
        }
        return false;
    }
    _setGraphNodeData(nodeId, data) {
        if (!this.graph.hasNode(nodeId))
            return;
        const graphNodeData = this.graph.getNodeData(nodeId) || {};
        graphNodeData.data = data;
        this.graph.setNodeData(nodeId, graphNodeData);
    }
    _setGraphNodeEdge(nodeId, fromPointer, toNodeId) {
        if (!this.graph.hasNode(nodeId))
            return;
        const graphNodeData = this.graph.getNodeData(nodeId) || {};
        graphNodeData.refMap = graphNodeData.refMap || {};
        graphNodeData.refMap[fromPointer] = toNodeId;
        this.graph.setNodeData(nodeId, graphNodeData);
    }
}

export { ResolveRunner, defaultGetRef };
