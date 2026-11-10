@EndUserText.label : 'Company code assignment to controlling area'
define table tka02 {
  key mandt : abap.clnt not null;
  key bukrs : abap.char(4) not null;
  kokrs     : abap.char(4);
}
