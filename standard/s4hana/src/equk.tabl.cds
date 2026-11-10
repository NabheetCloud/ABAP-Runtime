@EndUserText.label : 'Quota arrangement header'
define table equk {
  key mandt : abap.clnt not null;
  key qunum : abap.char(10) not null;
  matnr     : abap.char(40);
  werks     : abap.char(4);
  vdatu     : abap.dats;
  bdatu     : abap.dats;
}
