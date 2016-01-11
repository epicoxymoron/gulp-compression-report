const gutil = require('gulp-util');
const through = require('through2');
const StreamCounter = require('stream-counter');
const path = require('path');
const _ = require('lodash');
const chalk = require('chalk');
const _pluralize = require('pluralize');
const gzipSize = require('gzip-size');
const prettyBytes = require('pretty-bytes');
const Table = require('cli-table');

const PLUGIN_NAME = 'gulp-compression-report';

const log = gutil.log.bind(gutil, '[' + PLUGIN_NAME + ']:');

function pluralize(thing, count) {
  return _pluralize(thing, count, true);
}

/**
 * A map of normalized filename to the data for the files.
 */
const files = {};

/**
 * @typedef file
 * @param {string} name - the normalized filename
 * @param {object} [minified]
 * @param {number} [minified.size]
 * @param {object} [unminified]
 * @param {number} [unminified.size]
 */

/**
 * A map of extension name to the data for the extension
 */
const extensions = {
  '*': emptyExtension()
};

function emptyExtension() {
  return {
    count: {
      minified: 0,
      unminified: 0,
      both: 0
    },
    size: {
      minified: 0,
      unminified: 0,
      src: 0, // unminified, except where only has minified
      dist: 0, // minified, except where only has unminified
      gzip: 0 // gzipped version of "best" file
    }
  };
}

/**
 * @typedef extension
 * @param {object} count - file count
 * @param {number} count.both - the number of files with a minified AND a non-minified version
 * @param {number} count.minified - the number of minified-only files
 * @param {number} count.unminified - the number of unminified-only files
 * @param {object} size - file size
 * @param {number} size.src - the total file size of the "worst" version of each file
 * @param {number} size.dist - the total file size of the "best" version of each file

/**
 * @param {string} minifiedName - a regular expression to determine whether a
 *    file is minified or not; this will be stripped, if present, to determine
 *    the "normalized" file name.
 */
const options = {
  minifiedName: /\.min/,
  verbose: false
};

function normalizeFilename(filename) {
  return filename.replace(options.minifiedName, '');
}

function isMinified(filename) {
  return options.minifiedName.test(filename);
}

function gather(file, enc, cb) {

  /**
   * @param {object} data
   * @param {string} data.size
   */
  function record(err, data) {
    var name = file.relative;
    var normalized = normalizeFilename(name);
    var min = isMinified(name);
    var minKey = min ? 'minified' : 'unminified';
    var entry;

    if (!_.has(files, normalized)) {
      files[normalized] = {
        name: normalized
      };
    }
    files[normalized][minKey] = data;
  }

  if (file.isNull()) {
    return cb(null, file);
  }
/*
  if (file.isStream()) {
    gutil.log('stream')
    file.contents.pipe(new StreamCounter())
      .on('error', record)
      .on('finish', function () {
        record(null, {
          size: this.bytes
        });
      });
    return;
  }
*/
  record(null, {
    size: file.contents.length,
    gzipSize: gzipSize.sync(file.contents)
  });

  cb(null, file);
}

function determineCompressionSizeRatio(file) {
  // 500 -> 100 ==> 20% 
  // 500 -> 400 ==> 80%
  var minified   = _.get(file, 'minified.size',   0);
  var unminified = _.get(file, 'unminified.size', 0);
  var compressed = file[(minified ? 'minified' : 'unminified')].gzipSize;
  if (unminified && minified) {
    file.minificationSizeRatio = (minified / unminified);
  }
  file.compressionSizeRatio = compressed / (unminified || minified);
}

function postProcessFiles() {
  _.forOwn(files, function (data, name) {
    determineCompressionSizeRatio(data);

    var extension = _.last(name.split('.')).toLowerCase();

    if (!_.has(extensions, extension)) {
      extensions[extension] = emptyExtension();
    }

    const unminified = _.get(data, 'unminified.size', 0);
    const minified   = _.get(data, 'minified.size',   0);

    _.each(['*', extension], function (extension) {
      var entry = extensions[extension];

      entry.size.unminified += unminified;
      entry.size.minified   += minified;
      entry.size.src        += unminified || minified;
      entry.size.dist       += minified || unminified;
      entry.size.gzip       += data[(minified ? 'minified' : 'unminified')].gzipSize;

      if (unminified && !minified) {
        entry.count.unminified += 1;
      }
      if (!unminified && minified) {
        entry.count.minified += 1;
      }
      if (unminified && minified) {
        entry.count.both += 1;
      }
    });
  });
}

function postProcessExtensions() {
  _.forOwn(extensions, function (data, extension) {
    var totalCount = _.sum(data.count);
    data.minificationRatio = {
      count: (data.count.minified + data.count.both) / totalCount,
      size: (data.size.dist / data.size.src)
    };
    data.compressionRatio = (data.size.gzip / data.size.src)
  })
}

function opinion(bool) {
  return bool ? chalk.green('\u2713') : chalk.red('\u2717');
}

function report(cb) {
  var filenames = _.keys(files);
  var ratio, size, sortedFiles, sortedExtensions;
  var fileCount, needsMinification;
  var table, columns;

  if (!filenames.length) {
    gutil.log('no data');
    return cb();
  }

  postProcessFiles();
  postProcessExtensions();

  sortedFiles = _.sortBy(filenames);
  sortedExtensions = _.sortBy(_.without(_.keys(extensions), '*'));

  // count the files
  fileCount = filenames.length;
  log(pluralize('file', fileCount));
  log();

  // list out files that should be minfied, but aren't
  var needsMinification = _.filter(files, function (data) {
    return !data.minified;
  });
  if (needsMinification.length) {
    log('Missing minification: ' + needsMinification.length + '/' + fileCount);
    _.each(needsMinification, function (file) {
      log('  ' + opinion() + ' ' + file.name);
    });
  } else {
    log(opinion(true) + ' all files minified.  Great work!');
  }
  log();

  log('File Statistics');
  columns = ['file', 'size', 'minified size', 'gzipped size', 'min+gzip size', 'minification ratio', 'compression ratio', 'bytes over wire'];
  columns = _.map(columns, _.startCase);
  table = new Table({head: columns});

  function fileRow(filename) {
    function print(num) {
      return num ? prettyBytes(num) : '--';
    }
    function printPerc(num) {
      return num ? (100 * num).toFixed(0) + '%' : '--';
    }
    var size = _.get(files[filename], 'unminified.size');
    var printSize = print(size);
    var minSize = _.get(files[filename], 'minified.size');
    var printMinSize = print(minSize);
    var gzipSize = _.get(files[filename], 'unminified.gzipSize');
    var printGzipSize = print(gzipSize);
    var minGzipSize = _.get(files[filename], 'minified.gzipSize');
    var printMinGzipSize = print(minGzipSize);
    var minRatio = printPerc(files[filename].minificationSizeRatio);
    var compressionRatio = printPerc(files[filename].compressionSizeRatio);
    var wire = print(minGzipSize || gzipSize);

    table.push([filename, printSize, printMinSize, printGzipSize, printMinGzipSize, minRatio, compressionRatio, wire]);
  }

  _.each(sortedFiles, fileRow);
  log('\n' + table.toString() + '\n');

  log('Extension Statistics:');
  columns = ['extension', 'count', 'size', 'minified size', 'best gzip size', 'minification ratio', 'compression ratio', 'bytes over wire'];
  columns = _.map(columns, _.startCase);
  table = new Table({head: columns});

  function extensionRow(extension) {
    function print(num) {
      return num ? prettyBytes(num) : '--';
    }
    function printPerc(num) {
      return num ? (100 * num).toFixed(0) + '%' : '--';
    }
    var data = extensions[extension];
    var count = _.sum(_.values(data.count));
    var size = data.size.unminified;
    var printSize = print(size);
    var minSize = data.size.minified;
    var printMinSize = print(minSize);
    var gzipSize = data.size.gzip;
    var printGzipSize = print(gzipSize);
    var minRatio = printPerc(data.minificationRatio.size);
    var compressionRatio = printPerc(data.compressionRatio);
    var wire = print(data.size.gzip);

    table.push([extension, count, printSize, printMinSize, printGzipSize, minRatio, compressionRatio, wire]);
  }

  _.each(sortedExtensions, extensionRow);
  log('\n' + table.toString() + '\n');

  log('Overall Statistics:');
  columns = ['extension', 'count', 'size', 'minified size', 'best gzip size', 'minification ratio', 'compression ratio', 'bytes over wire'];
  columns = _.map(columns, _.startCase);
  table = new Table({head: columns});
  extensionRow('*');
  log('\n' + table.toString());
  log();

  return cb();
}

module.exports = function (opts) {
  options = _.defaults(opts, options);
  return through.obj(gather, report);
}
