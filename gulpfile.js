const gulp = require('gulp');
const report = require('./index.js');
const debug = require('gulp-debug');

gulp.task('good', function () {
  return gulp.src('test/**/*.css')
    .pipe(report());
});

gulp.task('bad', function () {
  return gulp.src('test/**/*')
    .pipe(report());
});