import type { IFunction, IFunctionResult } from '../types';
import type { Optional } from '@stoplight/types';

export interface IRulePatternOptions {
  /** regex that target must match */
  match?: string;

  /** regex that target must not match */
  notMatch?: string;
}

// regex in a string like {"match": "/[a-b]+/im"} or {"match": "[a-b]+"} in a json ruleset
// the available flags are "gimsuy" as described here: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp
const REGEXP_PATTERN = /^\/(.+)\/([a-z]*)$/;

function getFromCache(cache: Map<string, RegExp>, pattern: string): RegExp {
  const existingPattern = cache.get(pattern);
  if (existingPattern !== void 0) {
    return existingPattern;
  }

  const newPattern = createRegex(pattern);
  cache.set(pattern, newPattern);
  return newPattern;
}

function createRegex(pattern: string): RegExp {
  const splitRegex = REGEXP_PATTERN.exec(pattern);
  if (splitRegex !== null) {
    // with slashes like /[a-b]+/ and possibly with flags like /[a-b]+/im
    return new RegExp(splitRegex[1], splitRegex[2]);
  } else {
    // without slashes like [a-b]+
    return new RegExp(pattern);
  }
}

function assertValidOptions(opts: unknown): asserts opts is IRulePatternOptions {}

const cache = new Map<string, RegExp>();

export const pattern: IFunction = function (targetVal, opts) {
  if (typeof targetVal !== 'string') return;

  assertValidOptions(opts);

  let results: Optional<IFunctionResult[]>;

  const { match, notMatch } = opts;

  if (match !== void 0) {
    const pattern = getFromCache(cache, match);

    if (!pattern.test(targetVal)) {
      results = [
        {
          message: `must match the pattern '${match}'`,
        },
      ];
    }
  }

  if (notMatch !== void 0) {
    const pattern = getFromCache(cache, notMatch);

    if (pattern.test(targetVal)) {
      const result = {
        message: `must not match the pattern '${notMatch}'`,
      };

      if (results === void 0) {
        results = [result];
      } else {
        results.push(result);
      }
    }
  }

  return results;
};
