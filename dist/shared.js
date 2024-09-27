"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Gender = void 0;
exports.isQueryError = isQueryError;
var Gender;
(function (Gender) {
    Gender["MALE"] = "Male";
    Gender["FEMALE"] = "Female";
})(Gender || (exports.Gender = Gender = {}));
function isQueryError(obj) {
    return obj && typeof obj.message === 'string';
}
