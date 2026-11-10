@EndUserText.label : 'Country texts'
define table t005t {
  key mandt   : abap.clnt not null;
  key spras   : abap.lang not null;
  key land1   : abap.char(3) not null;
  landx       : abap.char(15);
  landx50     : abap.char(50);
  natio       : abap.char(15);
}
