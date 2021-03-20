import { Dictionary, Segment } from '@stoplight/types';
import { DepGraph } from 'dependency-graph';
import * as URI from 'urijs';
export interface IResolverOpts {
    uriCache?: ICache;
    resolvers?: {
        [scheme: string]: IResolver;
    };
    getRef?: (key: string, val: any) => string | void;
    transformRef?: (opts: IRefTransformer, ctx: any) => URI | void;
    parseResolveResult?: (opts: IUriParser) => Promise<IUriParserResult>;
    transformDereferenceResult?: (opts: IDereferenceTransformer) => Promise<ITransformerResult>;
    dereferenceInline?: boolean;
    dereferenceRemote?: boolean;
    ctx?: any;
}
export interface IResolveOpts extends IResolverOpts {
    jsonPointer?: string;
    baseUri?: string;
    parentPath?: string[];
    pointerStack?: string[];
}
export interface IResolveResult {
    result: any;
    refMap: {
        [source: string]: string;
    };
    graph: DepGraph<IGraphNodeData>;
    errors: IResolveError[];
    runner: IResolveRunner;
}
export interface IResolver {
    resolve(ref: URI, ctx: any): Promise<any>;
}
export interface IUriParser {
    result: any;
    fragment: string;
    uriResult: IUriResult;
    targetAuthority: URI;
    parentAuthority: URI;
    parentPath: string[];
}
export interface IUriParserResult {
    result?: any;
    error?: Error;
}
export interface IDereferenceTransformer {
    result: any;
    source: any;
    fragment: string;
    targetAuthority: URI;
    parentAuthority: URI;
    parentPath: string[];
}
export interface ITransformerResult {
    result?: any;
    error?: Error;
}
export interface IUriResult {
    pointerStack: string[];
    targetPath: string[];
    uri: URI;
    resolved?: IResolveResult;
    error?: IResolveError;
}
export interface IComputeRefOpts {
    key?: any;
    val: any;
    pointerStack: string[];
    jsonPointer?: string;
}
export interface IRefTransformer extends IComputeRefOpts {
    ref?: URI;
    uri: URI;
}
export declare type ResolverErrorCode = 'POINTER_MISSING' | 'RESOLVE_URI' | 'PARSE_URI' | 'RESOLVE_POINTER' | 'PARSE_POINTER' | 'TRANSFORM_DEREFERENCED';
export interface IResolveError {
    code: ResolverErrorCode;
    message: string;
    path: Segment[];
    uri: URI;
    uriStack: string[];
    pointerStack: string[];
}
export interface ICache {
    readonly stats: {
        hits: number;
        misses: number;
    };
    get(key: string): any;
    set(key: string, val: any): void;
    has(key: string): boolean;
    purge(): void;
}
export interface ICacheOpts {
    stdTTL?: number;
}
export interface IRefHandlerOpts {
    ref: URI;
    val: any;
    pointerStack: string[];
    cacheKey: string;
    resolvingPointer?: string;
    parentPath: string[];
    parentPointer: string;
}
export interface IGraphNodeData {
    refMap: Dictionary<string>;
    data?: any;
}
export interface IResolveRunner {
    id: number;
    source: any;
    dereferenceInline: boolean;
    dereferenceRemote: boolean;
    uriCache: ICache;
    depth: number;
    uriStack: string[];
    baseUri: URI;
    graph: DepGraph<IGraphNodeData>;
    root: string;
    atMaxUriDepth: () => boolean;
    resolve: (opts?: IResolveOpts) => Promise<IResolveResult>;
    computeRef: (opts: IComputeRefOpts) => URI | void | undefined;
    lookupAndResolveUri: (opts: IRefHandlerOpts) => Promise<IUriResult>;
}
export interface IResolveRunnerOpts extends IResolveOpts {
    root?: URI;
    depth?: number;
    uriStack?: string[];
}
export interface ICrawler {
    jsonPointer?: string;
    pointerGraph: DepGraph<string>;
    pointerStemGraph: DepGraph<string>;
    resolvers: Array<Promise<IUriResult>>;
    computeGraph: (target: any, parentPath: string[], parentPointer: string, pointerStack?: string[]) => void;
}
export interface ICrawlerResult {
    result: any;
    errors: IResolveError[];
}
