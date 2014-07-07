;(function () {

if ('undefined' === typeof PackageStubber) {
  PackageStubber = {}
}

"use strict";

var pwd = process.env.PWD,
    DEBUG = process.env.DEBUG,
    fs = Npm.require('fs'),
    path = Npm.require('path'),
    glob = Npm.require('glob'),
    _ = Npm.require('lodash'),
    defaultPackagesToIgnore = [
      'meteor-package-stubber',
      'package-stubber',
      'velocity',
      'mirror'
    ]

_.extend(PackageStubber, {

  /**
   * The string used to replace functions found on stubbed objects.
   *
   * @property {String} functionReplacementStr
   */
  functionReplacementStr: "function emptyFn () {}",


  /**
   * Holds validation functions for class functions.
   *
   * @property {Object} validate
   */
  validate: {

    /**
     * Validate function arguments
     * 
     * @method validate.stubPackages
     */
    stubPackages: function (options) {
      if ('string' != typeof options.outfile) {
        throw new Error("[PackageStubber.stubPackages] If supplied, the " +
                        "'outfile' field must be the path to a file to write " +
                        "stub output to.  It can be an absolute path or " +
                        "relative to the current Meteor application")
      }
      if (typeof options.dontStub !== 'string' &&
          !_.isArray(options.dontStub)) {
        throw new Error("[PackageStubber.stubPackages] If supplied, the " +
                        "'dontStub' field must be the name of a package or an " +
                        "array of package names")
      }
    },

    /**
     * Validate function arguments
     * 
     * @method validate.deepCopyReplaceFn
     */
    deepCopyReplaceFn: function (target, fnPlaceholder) {
      if (null === target ||
          'object' !== typeof target) {
        throw new Error("[PackageStubber.deepCopyReplaceFn] Required field `target` " +
                        "must be an object")
      }
      if (null !== fnPlaceholder &&
          'undefined' !== typeof fnPlaceholder &&
          'string' !== typeof fnPlaceholder) {
        throw new Error("[PackageStubber.deepCopyReplaceFn] If supplied, the " +
                        "'fnPlaceholder' field must be a string")
      }
    }

  },  // end validate


  /**
   * Create stubs for all smart packages in the current Meteor app.  
   * Stubs will be written to a javascript file.
   *
   * NOTE: This function must be run in a Meteor app's context so that the 
   * smart packages to stub are loaded and their object graphs can be traversed.
   *
   * @method stubPackages
   * @param {Object} options
   *   @param {Array|String} [dontStub] Name(s) of package(s) to ignore (ie. not
   *                           stub).
   *                           Default: []
   *   @param {String} [outfile] The file path to write the stubs to.
   *                           Can be either an absolute file path or relative 
   *                           to the current Meteor application.
   *                           Default: `tests/a1-package-stubs.js`
   */
  stubPackages: function (options) {
    var stubs = {},
        packagesToIgnore,
        coreStubs,
        usedPackages,
        packageExports = [],
        customStubs = [],
        name,
        out = "";

    options = options || {}

    options.outfile = options.outfile || 
                      path.join(pwd, 'tests', 'a1-package-stubs.js')
    options.dontStub = options.dontStub || []

    PackageStubber.validate.stubPackages(options)

    if (options.outfile[0] !== path.sep) {
      options.outfile = path.join(pwd, options.outfile)
    }

    if ('string' == typeof options.dontStub) {
      options.dontStub = [options.dontStub]
    } 

    // ignore test packages
    packagesToIgnore = PackageStubber.listTestPackages()

    // ignore defaults
    _.each(defaultPackagesToIgnore, function (packageName) {
      packagesToIgnore.push(packageName)
    })
    
    // ignore 'dontStub' packages
    _.each(options.dontStub, function (packageName) {
      packagesToIgnore.push(packageName)
    })


    // pull in all stubs for core packages.
    // these are always included since they are core and we have no way
    // to detect their use (even .meteor/packages doesn't have a complete
    // list since dependencies don't show up there).
    coreStubs = glob.sync(path.join(pwd, 'packages',
                                    'package-stubber', 'core-stubs', "*.js"))
    _.each(coreStubs, function (filePath) {
      var packageName = path.basename(filePath, '.js')

      DEBUG && console.log('[PackageStubber] custom stub found for core package',
                           packageName)
      packagesToIgnore.push(packageName)
      customStubs.push({
        package: packageName,
        filePath: filePath
      })
    })


    usedPackages = PackageStubber.listPackages()

    // check for custom stubs for community packages
    _.each(usedPackages, function (packageName) {
      var stubFile = packageName + ".js",
          stubFilePath = path.join(pwd, 'packages', 'package-stubber', 
                                   'community-stubs', stubFile)

      if (fs.existsSync(stubFilePath)) {
        DEBUG && console.log('[PackageStubber] custom stub found for package',
                             packageName)
        packagesToIgnore.push(packageName)
        customStubs.push({
          package: packageName,
          filePath: stubFilePath
        })
      }
    })
    
    // get list of package 'exports'
    packageExports = PackageStubber.listPackageExports({
                       packagesToIgnore: packagesToIgnore
                     })

    // build stubs
    _.each(packageExports, function (exportInfo) {
      var name = exportInfo.name,
          package = exportInfo.package,
          toStub = global[name]

      if (toStub) {
        DEBUG && console.log('[PackageStubber] stubbing', name, 
                             'in package', package)
        // `stubs` object will have one field of type `string` for each global
        // object that is being stubbed (ie. each package export)
        stubs[name] = PackageStubber.generateStubJsCode(toStub, name, package)
      } else {
        DEBUG && console.log('[PackageStubber] ignored missing export', name,
                             'from package', package + ". NOTE: You may have" +
                             " to stub this export yourself if you " +
                             "experience errors testing client-side code.")
      }
    })

    // prep for file write
    for (name in stubs) {
      out += "// " + name + "\n"
      out += name + " = " + stubs[name] + ";\n\n"
    }

    fs.writeFileSync(options.outfile, out)

    // append custom stubs
    _.each(customStubs, function (stubConfig) {
      DEBUG && console.log('[PackageStubber] appending custom stub for package',
                           stubConfig.package)
      fs.appendFileSync(options.outfile, fs.readFileSync(stubConfig.filePath))
    })
    
  },  // end stubPackages



  
  /**
   * Get the names of all test packages in a given Meteor application.
   * Test packages are identified by having `testPackage: true` in their
   * `smart.json` file.
   *
   * Used by PackageStubber to identify other packages to ignore.
   *
   * NOTE: Does not need to be run in a Meteor context.
   *
   * @method listTestPackages
   * @param {Object} [options]
   *   @param {String} [appDir] Directory path of Meteor application to 
   *                            identify test packages for.
   *                            Default: PWD (process working directory)
   * @return {Array} names of all test packages.  
   *                 Ex. ['jasmine-unit', 'mocha-web-velocity']
   */
  listTestPackages: function (options) {
    var smartJsonFiles,
        names = []
        
    options = options || {}

    options.appDir = normalizeAppDir(options)

    smartJsonFiles = glob.sync(path.join("**","smart.json"), 
                               {cwd: path.join(options.appDir, "packages")})

    _.each(smartJsonFiles, function (filePath) {
      var smartJson,
          fullPath = path.join(options.appDir, "packages", filePath);

      try {
        smartJson = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
        if (smartJson && smartJson.testPackage) {
          names.push(path.dirname(filePath))
        }
      } 
      catch (ex) {
        DEBUG && console.log('[PackageStubber]', filePath, ex)
      }
    })

    return names
  },  // end listTestPackages 


  /**
   * List the names of all non-core packages used by the app.
   *
   * @method listPackages
   * @param {Object} [options]
   *   @param {String} [appDir] Directory path of Meteor application to 
   *                            identify package exports for.
   *                            Default: PWD (process working directory)
   * @return {Array} names of all non-core packages used by app
   */
  listPackages: function (options) {
    options = options || {}

    options.appDir = normalizeAppDir(options)

    return ls (path.join(options.appDir, 'packages'))
  },


  /**
   * Get the names of all objects/functions which are exported by packages 
   * in a Meteor application.
   * Exports are identified by parsing each package's `package.js` file and
   * extracting out their `api.export(...)` calls.
   *
   * Used by PackageStubber to identify which global objects to stub.
   *
   * NOTE: Does not need to be run in a Meteor context.
   *
   * @method listPackageExports
   * @param {Object} [options]
   *   @param {String} [appDir] Directory path of Meteor application to 
   *                            identify package exports for.
   *                            Default: PWD (process working directory)
   * @return {Array} list of info objects about package exports
   *   ex. [{package: 'iron-router', name: 'RouteController'}, {...}]
   */
  listPackageExports: function (options) {
    var packageJsFiles,
        packageExports = [],
        exportsRE = /api\.export\s*\(\s*(['"])(.*?)\1/igm;
        
    options = options || {}

    options.appDir = normalizeAppDir(options)

    packageJsFiles = glob.sync(path.join("**", "package.js"), 
                               {cwd: path.join(options.appDir, "packages")})

    _.each(packageJsFiles, function (filePath) {
      var package = path.dirname(filePath),
          file,
          found;

      if (PackageStubber.shouldIgnorePackage(options.packagesToIgnore, filePath)) {
        DEBUG && console.log('[PackageStubber] ignoring', package)
        return
      }

      try {
        file = fs.readFileSync(path.join(options.appDir, "packages", filePath), 'utf8')
        while(found = exportsRE.exec(file)) {
          DEBUG && console.log('[PackageStubber] found', found[2], 'in', filePath)
          packageExports.push({
            package: package,
            name: found[2]
          })
        }
      } catch (ex) {
        DEBUG && console.log('[PackageStubber] Error reading file', filePath, ex)
      }
    })

    return packageExports
  },  // end listPackageExports


  /**
   * Performs a deep copy of the target object, replacing all function fields
   * with a string placeholder.
   *
   * @method deepCopyReplaceFn
   * @param {Object} target The object that will be stubbed.
   * @param {String} [fnPlaceholder] string to use in place of any function 
   *                 fields.  Default: "FUNCTION_PLACEHOLDER"
   * @return {Object} new object, with all functions replaced with the
   *                  fnPlaceholder string
   */
  deepCopyReplaceFn: function (target, fnPlaceholder) {
    var dest = {},
        fieldName,
        type

    PackageStubber.validate.deepCopyReplaceFn(target, fnPlaceholder)

    fnPlaceholder = fnPlaceholder || "FUNCTION_PLACEHOLDER"

    for (fieldName in target) {
      type = typeof target[fieldName]
      switch (type) {
        case "number":
          dest[fieldName] = target[fieldName]
          break;
        case "string":
          dest[fieldName] = target[fieldName]
          break;
        case "function":
          dest[fieldName] = fnPlaceholder;
          break;
        case "object":
          if (target[fieldName] === null) {
            dest[fieldName] = null
          } else if (target[fieldName] instanceof Date) {
            dest[fieldName] = new Date(target[fieldName])
          } else {
            dest[fieldName] = PackageStubber.deepCopyReplaceFn(
                                                  target[fieldName],
                                                  fnPlaceholder)
          }
          break;
      }
    }

    return dest
  },  // end deepCopyReplaceFn


  shouldIgnorePackage: function (packagesToIgnore, packagePath) {
    return _.some(packagesToIgnore, function (packageName) {
      return packagePath.indexOf(packageName) == 0
    })
  },

  /**
   * Neither JSON.stringify() nor .toString() work for functions so we "stub"
   * functions by:
   *   1. replacing them with a placeholder string
   *   2. `JSON.stringify`ing the resulting object
   *   3. converting placeholders to empty function code in string form
   *
   * We need to do the string replacement in two steps because otherwise the
   * `JSON.stringify` step would escape our functions incorrectly.
   *
   * @method replaceFnPlaceholders
   * @param {String} str String to convert
   * @param {String} [placeHolder] string to replace.  
   *                 Default: "FUNCTION_PLACEHOLDER"
   * @param {String} [replacement] replacement for placeholder strings.
   *                 Default: PackageStubber.functionReplacementStr
   * @return {String} string with all placeholder strings replaced 
   *                  with `PackageStubber.functionReplacementStr`
   */
  replaceFnPlaceholders: function (str, placeholder, replacement) {
    var regex

    placeholder = placeholder || '"FUNCTION_PLACEHOLDER"'
    replacement = replacement || PackageStubber.functionReplacementStr

    regex = new RegExp(placeholder, 'g')

    return str.replace(regex, replacement)
  },  // end replaceFnPlaceholders


  stubGenerators: {

    /**
     * Generates a stub in string form for function types.
     *
     * @method stubGenerators.function
     * @param {Function} target Target function to stub
     * @param {String} name Name of target object for use in reporting errors
     * @param {String} package Name of target package for use in errors
     * @return {String} Javascript code in string form which, when executed, 
     *                  builds the stub in the then-current global context
     */
    'function': function (target, name, package) {
      var stubInStringForm,
          defaultReturnStr = PackageStubber.functionReplacementStr,
          objStubber = PackageStubber.stubGenerators['object']

      // Attempt to instantiate new constructor with no parameters.
      //   ex. moment().format('MMM dd, YYYY')
      // Some packages have global function objects which throw an error
      // if no parameters are passed (ex. IronRouter's RouteController).
      // In this case, not much we can do.  Just alert the user and stub
      // with an empty function.

      try {
        target = target()
        stubInStringForm = objStubber(target, name, package)
        stubInStringForm = "function () { return " + stubInStringForm + "; }"
        return stubInStringForm
      } catch (ex) {
        console.log("[PackageStubber] Calling exported function '" +
                    name + "' in package '" + package + "' with no parameters" +
                    " produced an error. " +
                    "'" + name + "' has been stubbed with an empty function " +
                    "but if you receive errors due to missing fields in " +
                    "this package, you will need to supply your own " +
                    "custom stub. The original error was: ", ex.message)
        return defaultReturnStr
      }
    },

    /**
     * Generates a stub in string form for object types.
     *
     * @method stubGenerators.object
     * @param {Object} target Target object to stub
     * @param {String} name Name of target object for use in reporting errors
     * @param {String} package Name of target package for use in errors
     * @return {String} String representation of the target object.
     */
    'object': function (target, name, package) {
      var intermediateStub,
          stubInStringForm,
          defaultReturnStr = "{}"

      try {
        intermediateStub = PackageStubber.deepCopyReplaceFn(target)
        stubInStringForm = PackageStubber.replaceFnPlaceholders(
                               JSON.stringify(intermediateStub, null, 2))
        return stubInStringForm
      } catch (ex) {
        console.log("[PackageStubber] Error generating stub for exported " +
                    "object '" + name + " in package '" + package + "'. " +
                    name + "' has been " +
                    "stubbed with an empty object but if you receive " +
                    "errors due to missing fields in this package, you " +
                    "will need to supply your own custom stub. The " +
                    "original error follows:\n", ex.message)
        return defaultReturnStr
      }
    },

    /**
     * Generates a stub in string form for string types.
     *
     * @method stubGenerators.string
     * @param {Object} target Target string to stub
     * @param {String} name Name of target string for use in reporting errors
     * @return {String} The original target string, passed through
     */
    'string': function (target, name) {
      return target
    },

    /**
     * Generates a stub in string form for number types.
     *
     * @method stubGenerators.number
     * @param {Object} target Target number to stub
     * @param {String} name Name of target number for use in reporting errors
     * @return {String} The original target number, converted to a string
     */
    'number': function (target, name) {
      return target.toString()
    },

    /**
     * Generates a stub in string form for undefined targets.
     *
     * @method stubGenerators.undefined
     * @return {String} "undefined"
     */
    'undefined': function () {
      return 'undefined'
    }

  },  // end stubGenerators


  /**
   * Creates a stub of the target object or function.  Stub is in the form
   * of js code in string form which, when executed, builds the stubs in 
   * the then-current global context.
   *
   * Useful when auto-stubbing Meteor packages and then running unit tests
   * in a new, Meteor-free context.
   *
   * @method generateStubJsCode
   * @param {Any} target Target to stub
   * @param {String} name Name thing to stub for use in reporting errors
   * @param {String} package Name of target package for use in errors
   * @return {String} Javascript code in string form which, when executed, 
   *                  builds the stub in the then-current global context
   */
  generateStubJsCode: function (target, name, package) {
    var typeOfTarget = typeof target,
        stubGenerator 

    if (null === target) {
      // handle null special case since it has type "object"
      return "null"
    }

    // dispatch to generator function based on type of target

    stubGenerator = PackageStubber.stubGenerators[typeOfTarget]

    if (!stubGenerator) {
      throw new Error("[PackageStubber] Could not stub package export '" +
                      name + "' in package '" + package + "'.  Missing stub " +
                      "generator for type", typeOfTarget)
    }

    return stubGenerator(target, name, package)

  }  // end generateStubJsCode

})  // end _.extend PackageStubber



/**
 * List all non-hidden directories in target directory
 *
 * @method ls
 * @return {Array} list of all non-hidden directories in target directory
 * @private
 */
function ls (rootDir) {
  var files = fs.readdirSync(rootDir)

  return _.reduce(files, function (memo, file) {
    var filePath,
        stat

    if (file[0] != '.') {
      filePath = path.join(rootDir, file)
      stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        memo.push(file)
      }
    }

    return memo
  }, [])
}  // end ls


/**
 * Normalizes path to application directory.
 * If `appDir` field is not set on `options` param,
 * uses PWD.
 *
 * @method normalizeAppDir
 * @param {Object} [options] Optional, options object containing an `appDir` 
 *                           string field pointing to the target Meteor
 *                           application to process.
 * @return {String} the normalized application directory
 */
function normalizeAppDir (options) {
  var pwd = process.env.PWD

  if (!options || 'string' !== typeof options.appDir) {
    return pwd
  }

  if (options.appDir && options.appDir[0] !== path.sep) {
    // relative path, prepend PWD
    return path.join(pwd, options.appDir)
  }

  return options.appDir
}  // end normalizeAppDir


})();
