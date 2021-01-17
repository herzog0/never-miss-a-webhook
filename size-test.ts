const ECMA_SIZES = {
    STRING: 2,
    BOOLEAN: 4,
    NUMBER: 8
}

function allProperties(obj: any) {
    const stringProperties = []
    for (const prop in obj) {
        if (obj.hasOwnProperty(prop)) {
            stringProperties.push(prop)
        }
    }
    if (Object.getOwnPropertySymbols) {
        const symbolProperties = Object.getOwnPropertySymbols(obj)
        Array.prototype.push.apply(stringProperties, symbolProperties)
    }
    return stringProperties
}

function sizeOfObject (seen: any, object: any) {
    if (object == null) {
        return 0
    }

    let bytes = 0
    const properties = allProperties(object)
    for (let i = 0; i < properties.length; i++) {
        const key = properties[i]
        // Do not recalculate circular references
        if (typeof object[key] === 'object' && object[key] !== null) {
            if (seen.has(object[key])) {
                continue
            }
            seen.add(object[key])
        }

        bytes += getCalculator(seen)(key)
        try {
            bytes += getCalculator(seen)(object[key])
        } catch (ex) {
            if (ex instanceof RangeError) {
                // circular reference detected, final result might be incorrect
                // let's be nice and not throw an exception
                bytes = 0
            }
        }
    }

    return bytes
}

function getCalculator (seen: any) {
    return function calculator(object: any): any {
        if (Buffer.isBuffer(object)) {
            return object.length
        }

        const objectType = typeof (object)
        switch (objectType) {
            case 'string':
                return object.length * ECMA_SIZES.STRING
            case 'boolean':
                return ECMA_SIZES.BOOLEAN
            case 'number':
                return ECMA_SIZES.NUMBER
            case 'symbol':
                const isGlobalSymbol = Symbol.keyFor && Symbol.keyFor(object)
                if (isGlobalSymbol) {
                    const symbolKeyFor = Symbol.keyFor(object)
                    if(symbolKeyFor) {
                        return symbolKeyFor.length * ECMA_SIZES.STRING
                    } else {
                        return 0
                    }
                } else {
                    return (object.toString().length - 8) * ECMA_SIZES.STRING
                }
            case 'object':
                if (Array.isArray(object)) {
                    return object.map(getCalculator(seen)).reduce(function (acc, curr) {
                        return acc + curr
                    }, 0)
                } else {
                    return sizeOfObject(seen, object)
                }
            default:
                return 0
        }
    }
}

function sizeof (object: any) {
    return getCalculator(new WeakSet())(object)
}
const obj = {"teo": 1234,"asubcasdoi":"asvghdsasd"}
const payloadBuffer = Buffer.from(JSON.stringify(obj), 'base64')

const payload = payloadBuffer.toString('ascii')

console.log(sizeof(payload))
console.log(payload.length)
console.log(payloadBuffer.length)
console.log(payload)
console.log(JSON.stringify(obj))
console.log(JSON.stringify(obj).length)