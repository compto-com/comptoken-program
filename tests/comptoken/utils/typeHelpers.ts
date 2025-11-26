type CamelToSnakeCase<S extends string> = S extends `${infer T}${infer U}`
    ? U extends Uncapitalize<U>
        ? `${Lowercase<T>}${CamelToSnakeCase<U>}`
        : `${Lowercase<T>}_${CamelToSnakeCase<U>}`
    : S extends Uppercase<S>
    ? Lowercase<S>
    : S;

export type CamelToSnakeCaseObject<T> = {
    [K in keyof T as CamelToSnakeCase<string & K>]: T[K];
};
