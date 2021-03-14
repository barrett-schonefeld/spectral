import { Optional } from '@stoplight/types';
import * as AJV from 'ajv';
import { ValidateFunction } from 'ajv';
import * as jsonSpecV4 from 'ajv/lib/refs/json-schema-draft-04.json';
import * as jsonSpecV6 from 'ajv/lib/refs/json-schema-draft-06.json';
import * as jsonSpecV7 from 'ajv/lib/refs/json-schema-draft-07.json';
import { IFunction } from '../types';
export interface ISchemaFunction extends IFunction<ISchemaOptions> {
    Ajv: typeof AJV;
    specs: {
        v4: typeof jsonSpecV4;
        v6: typeof jsonSpecV6;
        v7: typeof jsonSpecV7;
    };
    createAJVInstance(opts: AJV.Options): AJV.Ajv;
}
export interface ISchemaOptions {
    schema: object;
    oasVersion?: Optional<2 | 3 | 3.1>;
    allErrors?: boolean;
    ajv?: ValidateFunction;
    prepareResults?(errors: AJV.ErrorObject[]): void;
}
export declare const schema: IFunction;
