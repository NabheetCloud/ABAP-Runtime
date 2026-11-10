@EndUserText.label : 'Documents'
define table zdoc_a {
  key client  : abap.clnt not null;
  key doc_id  : abap.char(10) not null;
  title       : abap.char(60);
  attachment  : abap.rawstring(0);
  mime_type   : abap.char(128);
  file_name   : abap.char(128);
}
