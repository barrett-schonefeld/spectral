import createOrderedObject, { getOrder } from '@stoplight/ordered-object-literal';
import { DiagnosticSeverity } from '@stoplight/types';
import { load, Kind, determineScalarType, ScalarType, parseYamlFloat, parseYamlBigInteger, parseYamlBoolean } from '@stoplight/yaml-ast-parser';
import { buildJsonPath } from './buildJsonPath.mjs';
import { dereferenceAnchor } from './dereferenceAnchor.mjs';
import { lineForPosition } from './lineForPosition.mjs';
import { isObject } from './utils.mjs';

const parseWithPointers = (value, options) => {
    const lineMap = computeLineMap(value);
    const ast = load(value, Object.assign({}, options, { ignoreDuplicateKeys: true }));
    const parsed = {
        ast,
        lineMap,
        data: undefined,
        diagnostics: [],
        metadata: options,
    };
    if (!ast)
        return parsed;
    parsed.data = walkAST(ast, options, lineMap, parsed.diagnostics);
    if (ast.errors) {
        parsed.diagnostics.push(...transformErrors(ast.errors, lineMap));
    }
    if (parsed.diagnostics.length > 0) {
        parsed.diagnostics.sort((itemA, itemB) => itemA.range.start.line - itemB.range.start.line);
    }
    if (Array.isArray(parsed.ast.errors)) {
        parsed.ast.errors.length = 0;
    }
    return parsed;
};
const walkAST = (node, options, lineMap, diagnostics) => {
    if (node) {
        switch (node.kind) {
            case Kind.MAP: {
                const preserveKeyOrder = options !== void 0 && options.preserveKeyOrder === true;
                const container = createMapContainer(preserveKeyOrder);
                const seenKeys = [];
                const handleMergeKeys = options !== void 0 && options.mergeKeys === true;
                const yamlMode = options !== void 0 && options.json === false;
                const handleDuplicates = options !== void 0 && options.ignoreDuplicateKeys === false;
                for (const mapping of node.mappings) {
                    if (!validateMappingKey(mapping, lineMap, diagnostics, yamlMode))
                        continue;
                    const key = String(getScalarValue(mapping.key));
                    if ((yamlMode || handleDuplicates) && (!handleMergeKeys || key !== "<<")) {
                        if (seenKeys.includes(key)) {
                            if (yamlMode) {
                                throw new Error('Duplicate YAML mapping key encountered');
                            }
                            if (handleDuplicates) {
                                diagnostics.push(createYAMLException(mapping.key, lineMap, 'duplicate key'));
                            }
                        }
                        else {
                            seenKeys.push(key);
                        }
                    }
                    if (handleMergeKeys && key === "<<") {
                        const reduced = reduceMergeKeys(walkAST(mapping.value, options, lineMap, diagnostics), preserveKeyOrder);
                        Object.assign(container, reduced);
                    }
                    else {
                        container[key] = walkAST(mapping.value, options, lineMap, diagnostics);
                        if (preserveKeyOrder) {
                            pushKey(container, key);
                        }
                    }
                }
                return container;
            }
            case Kind.SEQ:
                return node.items.map(item => walkAST(item, options, lineMap, diagnostics));
            case Kind.SCALAR: {
                const bigInt = options !== void 0 && options.bigInt === true;
                const value = getScalarValue(node);
                return !bigInt && typeof value === 'bigint' ? Number(value) : value;
            }
            case Kind.ANCHOR_REF: {
                if (isObject(node.value)) {
                    node.value = dereferenceAnchor(node.value, node.referencesAnchor);
                }
                return walkAST(node.value, options, lineMap, diagnostics);
            }
            default:
                return null;
        }
    }
    return node;
};
function getScalarValue(node) {
    switch (determineScalarType(node)) {
        case ScalarType.null:
            return null;
        case ScalarType.string:
            return String(node.value);
        case ScalarType.bool:
            return parseYamlBoolean(node.value);
        case ScalarType.int:
            return parseYamlBigInteger(node.value);
        case ScalarType.float:
            return parseYamlFloat(node.value);
    }
}
const computeLineMap = (input) => {
    const lineMap = [];
    let i = 0;
    for (; i < input.length; i++) {
        if (input[i] === '\n') {
            lineMap.push(i + 1);
        }
    }
    lineMap.push(i + 1);
    return lineMap;
};
function getLineLength(lineMap, line) {
    if (line === 0) {
        return Math.max(0, lineMap[0] - 1);
    }
    return Math.max(0, lineMap[line] - lineMap[line - 1] - 1);
}
const transformErrors = (errors, lineMap) => {
    const validations = [];
    for (const error of errors) {
        const validation = {
            code: error.name,
            message: error.reason,
            severity: error.isWarning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
            range: {
                start: {
                    line: error.mark.line,
                    character: error.mark.column,
                },
                end: {
                    line: error.mark.line,
                    character: error.mark.toLineEnd ? getLineLength(lineMap, error.mark.line) : error.mark.column,
                },
            },
        };
        validations.push(validation);
    }
    return validations;
};
const reduceMergeKeys = (items, preserveKeyOrder) => {
    if (Array.isArray(items)) {
        const reduced = items.reduceRight(preserveKeyOrder
            ? (merged, item) => {
                const keys = Object.keys(item);
                Object.assign(merged, item);
                for (let i = keys.length - 1; i >= 0; i--) {
                    unshiftKey(merged, keys[i]);
                }
                return merged;
            }
            : (merged, item) => Object.assign(merged, item), createMapContainer(preserveKeyOrder));
        return reduced;
    }
    return typeof items !== 'object' || items === null ? null : Object(items);
};
function createMapContainer(preserveKeyOrder) {
    return preserveKeyOrder ? createOrderedObject({}) : {};
}
function deleteKey(container, key) {
    if (!(key in container))
        return;
    const order = getOrder(container);
    const index = order.indexOf(key);
    if (index !== -1) {
        order.splice(index, 1);
    }
}
function unshiftKey(container, key) {
    deleteKey(container, key);
    getOrder(container).unshift(key);
}
function pushKey(container, key) {
    deleteKey(container, key);
    getOrder(container).push(key);
}
function validateMappingKey(mapping, lineMap, diagnostics, yamlMode) {
    if (mapping.key.kind !== Kind.SCALAR) {
        if (!yamlMode) {
            diagnostics.push(createYAMLIncompatibilityException(mapping.key, lineMap, 'mapping key must be a string scalar', yamlMode));
        }
        return false;
    }
    if (!yamlMode) {
        const type = typeof getScalarValue(mapping.key);
        if (type !== 'string') {
            diagnostics.push(createYAMLIncompatibilityException(mapping.key, lineMap, `mapping key must be a string scalar rather than ${mapping.key.valueObject === null ? 'null' : type}`, yamlMode));
        }
    }
    return true;
}
function createYAMLIncompatibilityException(node, lineMap, message, yamlMode) {
    const exception = createYAMLException(node, lineMap, message);
    exception.code = 'YAMLIncompatibleValue';
    exception.severity = yamlMode ? DiagnosticSeverity.Hint : DiagnosticSeverity.Warning;
    return exception;
}
function createYAMLException(node, lineMap, message) {
    const startLine = lineForPosition(node.startPosition, lineMap);
    const endLine = lineForPosition(node.endPosition, lineMap);
    return {
        code: 'YAMLException',
        message,
        severity: DiagnosticSeverity.Error,
        path: buildJsonPath(node),
        range: {
            start: {
                line: startLine,
                character: startLine === 0 ? node.startPosition : node.startPosition - lineMap[startLine - 1],
            },
            end: {
                line: endLine,
                character: endLine === 0 ? node.endPosition : node.endPosition - lineMap[endLine - 1],
            },
        },
    };
}

export { parseWithPointers, walkAST };
