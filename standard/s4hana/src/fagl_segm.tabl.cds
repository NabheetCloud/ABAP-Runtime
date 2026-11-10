@EndUserText.label : 'Segments'
define table fagl_segm {
  key mandt   : abap.clnt not null;
  key segment : abap.char(10) not null;
  name        : abap.char(40);
}
