import { DiagnosticSeverity, Optional } from '@stoplight/types';
import * as jp from 'jsonpath-plus';
import type { JSONPathCallback } from 'jsonpath-plus';
import { isObject } from 'lodash-es';
import { JSONPathExpression, traverse } from 'nimma';

import { IDocument, STDIN } from '../document';
import { DocumentInventory } from '../documentInventory';
import { IGivenNode, IRuleResult } from '../types';
import { ComputeFingerprintFunc, prepareResults } from '../utils';
import { generateDocumentWideResult } from '../utils/generateDocumentWideResult';
import { lintNode } from './lintNode';
import { RunnerRuntime } from './runtime';
import { IRunnerInternalContext } from './types';
import { ExceptionLocation, pivotExceptions } from './utils';
import { Rule } from '../ruleset/rule/rule';
import { Ruleset } from '../ruleset/ruleset';

const { JSONPath } = jp;

const isStdInSource = (inventory: DocumentInventory): boolean => {
  return inventory.document.source === STDIN;
};

const generateDefinedExceptionsButStdIn = (documentInventory: DocumentInventory): IRuleResult => {
  return generateDocumentWideResult(
    documentInventory.document,
    'The ruleset contains `except` entries. However, they cannot be enforced when the input is passed through stdin.',
    DiagnosticSeverity.Warning,
    'except-but-stdin',
  );
};

const runRule = (
  context: IRunnerInternalContext,
  rule: Rule,
  exceptRuleByLocations: Optional<ExceptionLocation[]>,
): void => {
  const target = rule.resolved ? context.documentInventory.resolved : context.documentInventory.unresolved;

  if (!isObject(target)) {
    return;
  }

  for (const given of rule.given) {
    // don't have to spend time running jsonpath if given is $ - can just use the root object
    if (given === '$') {
      lintNode(
        context,
        {
          path: ['$'],
          value: target,
        },
        rule,
        exceptRuleByLocations,
      );
    } else {
      JSONPath({
        path: given,
        json: target,
        resultType: 'all',
        callback: (result => {
          lintNode(
            context,
            {
              // @ts-expect-error
              // this is needed due to broken typings in jsonpath-plus (JSONPathClass.toPathArray is correct from typings point of view, but JSONPathClass is not exported, so it fails at runtime)
              path: JSONPath.toPathArray(result.path),
              value: result.value,
            },
            rule,
            exceptRuleByLocations,
          );
        }) as JSONPathCallback,
      });
    }
  }
};

export class Runner {
  public readonly results: IRuleResult[];

  constructor(protected readonly runtime: RunnerRuntime, protected readonly inventory: DocumentInventory) {
    this.results = [...this.inventory.diagnostics, ...this.document.diagnostics, ...(this.inventory.errors ?? [])];
  }

  protected get document(): IDocument {
    return this.inventory.document;
  }

  public addResult(result: IRuleResult): void {
    this.results.push(result);
  }

  public async run(ruleset: Ruleset): Promise<void> {
    this.runtime.emit('setup');

    const { inventory: documentInventory } = this;

    const runnerContext: IRunnerInternalContext = {
      ruleset,
      documentInventory,
      results: this.results,
      promises: [],
    };

    const isStdIn = isStdInSource(documentInventory);
    const exceptRuleByLocations =
      isStdIn || ruleset.exceptions === null ? {} : pivotExceptions(ruleset.exceptions, ruleset.rules);

    if (isStdIn && ruleset.exceptions !== null && Object.keys(ruleset.exceptions).length > 0) {
      runnerContext.results.push(generateDefinedExceptionsButStdIn(documentInventory));
    }

    const relevantRules = Object.values(ruleset.rules).filter(
      rule => rule.enabled && rule.matchesFormat(documentInventory.formats),
    );

    const optimizedRules: Rule[] = [];
    const optimizedUnresolvedRules: Rule[] = [];
    const unoptimizedRules: Rule[] = [];

    const traverseCb = (rule: Rule, node: IGivenNode): void => {
      lintNode(runnerContext, node, rule, exceptRuleByLocations[rule.name]);
    };

    for (const rule of relevantRules) {
      if (!rule.isOptimized) {
        unoptimizedRules.push(rule);
        continue;
      }

      if (rule.resolved) {
        optimizedRules.push(rule);
      } else {
        optimizedUnresolvedRules.push(rule);
      }

      rule.hookup(traverseCb);
    }

    if (optimizedRules.length > 0) {
      traverse(Object(runnerContext.documentInventory.resolved), optimizedRules.flatMap(pickExpressions));
    }

    if (optimizedUnresolvedRules.length > 0) {
      traverse(Object(runnerContext.documentInventory.unresolved), optimizedUnresolvedRules.flatMap(pickExpressions));
    }

    for (const rule of unoptimizedRules) {
      try {
        runRule(runnerContext, rule, exceptRuleByLocations[rule.name]);
      } catch (ex) {
        console.error(ex);
      }
    }

    this.runtime.emit('beforeTeardown');

    try {
      if (runnerContext.promises.length > 0) {
        await Promise.all(runnerContext.promises);
      }
    } finally {
      this.runtime.emit('afterTeardown');
    }
  }

  public getResults(computeFingerprint: ComputeFingerprintFunc): IRuleResult[] {
    return prepareResults(this.results, computeFingerprint);
  }
}

function pickExpressions({ expressions }: Rule): JSONPathExpression[] {
  return expressions!;
}
