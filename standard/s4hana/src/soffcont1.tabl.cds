@EndUserText.label : 'Office document content'
define table soffcont1 {
  key mandt    : abap.clnt not null;
  key relid    : abap.char(2) not null;
  key phio_id  : abap.char(32) not null;
  objtp        : abap.char(3);
  objyr        : abap.char(2);
  objno        : abap.char(12);
  objdes       : abap.char(50);
  file_ext     : abap.char(3);
  clustr       : abap.int4;
  clustd       : abap.char(255);
}
