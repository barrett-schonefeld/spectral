import { DiagnosticSeverity } from '@stoplight/types';
import { Spectral } from '../../../spectral';

import { createWithRules } from './__helpers__/createWithRules';

describe('oas3-valid-schema-example', () => {
  let s: Spectral;

  beforeEach(async () => {
    s = await createWithRules(['oas3-valid-schema-example']);
  });

  describe.each(['components', 'headers'])('%s', field => {
    test('will pass when simple example is valid', async () => {
      const results = await s.run({
        openapi: '3.0.2',
        [field]: {
          schemas: {
            xoxo: {
              type: 'string',
              example: 'doggie',
            },
          },
        },
      });
      expect(results).toHaveLength(0);
    });

    test('will pass when default value is valid', async () => {
      const results = await s.run({
        openapi: '3.0.2',
        [field]: {
          schemas: {
            xoxo: {
              type: 'string',
              example: 'doggie',
            },
          },
        },
      });
      expect(results).toHaveLength(0);
    });

    test('will fail when simple example is invalid', async () => {
      const results = await s.run({
        openapi: '3.0.2',
        [field]: {
          schemas: {
            xoxo: {
              type: 'string',
              example: 123,
            },
          },
        },
      });
      expect(results).toEqual([
        expect.objectContaining({
          severity: DiagnosticSeverity.Error,
          code: 'oas3-valid-schema-example',
          message: '`example` property type must be string',
        }),
      ]);
    });

    test('will fail when default value is invalid', async () => {
      const results = await s.run({
        openapi: '3.0.2',
        [field]: {
          schemas: {
            xoxo: {
              type: 'string',
              default: 2,
            },
          },
        },
      });
      expect(results).toEqual([
        expect.objectContaining({
          code: 'oas3-valid-schema-example',
          message: '`default` property type must be string',
          severity: DiagnosticSeverity.Error,
        }),
      ]);
    });

    test('will fail for valid parents examples which contain invalid child examples', async () => {
      const results = await s.run({
        openapi: '3.0.2',
        info: {
          version: '1.0.0',
          title: 'Swagger Petstore',
        },
        [field]: {
          schemas: {
            post: {
              schema: {
                type: 'object',
                example: {
                  a: {
                    b: {
                      c: 'foo',
                    },
                  },
                },
                properties: {
                  a: {
                    type: 'object',
                    example: {
                      b: {
                        c: 'foo',
                      },
                    },
                    properties: {
                      b: {
                        type: 'object',
                        properties: {
                          c: {
                            type: 'string',
                            example: 12345,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      expect(results).toEqual([
        expect.objectContaining({
          code: 'oas3-valid-schema-example',
          message: '`example` property type must be string',
          path: [
            field,
            'schemas',
            'post',
            'schema',
            'properties',
            'a',
            'properties',
            'b',
            'properties',
            'c',
            'example',
          ],
          range: expect.any(Object),
          severity: DiagnosticSeverity.Error,
        }),
      ]);
    });

    describe.each(['', null, 0, false])('given falsy %s value', value => {
      test('will validate empty value', async () => {
        const results = await s.run({
          openapi: '3.0.2',
          [field]: {
            schemas: {
              xoxo: {
                enum: ['a', 'b'],
                example: value,
              },
            },
          },
        });

        expect(results).toEqual([
          expect.objectContaining({
            code: 'oas3-valid-schema-example',
            message: '`example` property must be equal to one of the allowed values: `a`, `b`',
            severity: DiagnosticSeverity.Error,
          }),
        ]);
      });
    });

    test('will pass when complex example is used ', async () => {
      const results = await s.run({
        openapi: '3.0.2',
        [field]: {
          schemas: {
            xoxo: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                },
                width: {
                  type: 'integer',
                },
                height: {
                  type: 'integer',
                },
              },
              required: ['url'],
              example: {
                url: 'images/38.png',
                width: 100,
                height: 100,
              },
            },
          },
        },
      });

      expect(results).toHaveLength(0);
    });

    test('will fail when complex example is used', async () => {
      const data = {
        openapi: '3.0.2',
        components: {
          schemas: {
            xoxo: {
              type: 'number',
              example: 4,
            },
            abc: {
              type: 'object',
              properties: {
                id: {
                  type: 'integer',
                  format: 'int64',
                },
                name: {
                  type: 'string',
                },
                abc: {
                  type: 'number',
                  example: '5',
                },
              },
              required: ['name'],
              example: {
                name: 'Puma',
                id: 1,
              },
            },
          },
        },
      };

      const results = await s.run(data);

      expect(results).toEqual([
        expect.objectContaining({
          code: 'oas3-valid-schema-example',
          message: '`example` property type must be number',
          severity: DiagnosticSeverity.Error,
        }),
      ]);
    });

    test('will error with totally invalid input', async () => {
      const results = await s.run({
        openapi: '3.0.2',
        [field]: {
          schemas: {
            xoxo: {
              type: 'object',
              properties: {
                url: {
                  type: 'string',
                },
                width: {
                  type: 'integer',
                },
                height: {
                  type: 'integer',
                },
              },
              required: ['url'],
              example: {
                url2: 'images/38.png',
                width: 'coffee',
                height: false,
              },
            },
          },
        },
      });

      expect(results).toEqual([
        expect.objectContaining({
          code: 'oas3-valid-schema-example',
          message: '`example` property must have required property `url`',
          severity: DiagnosticSeverity.Error,
        }),
      ]);
    });

    test('does not report example mismatches for unknown AJV formats', async () => {
      const results = await s.run({
        openapi: '3.0.2',
        [field]: {
          xoxo: {
            schema: {
              type: 'object',
              properties: {
                ip_address: {
                  type: 'integer',
                  format: 'foo',
                  example: 2886989840,
                },
              },
            },
          },
        },
      });

      expect(results).toEqual([]);
    });
  });
});
