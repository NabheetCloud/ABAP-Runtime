@EndUserText.label : 'Runs of jobs and background processes'
define table zcloud_run {
  key client : abap.clnt not null;
  key id     : abap.char(32) not null;
  source     : abap.char(10);
  text       : abap.char(40);
}
