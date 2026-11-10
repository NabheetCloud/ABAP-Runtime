@EndUserText.label : 'Tax classification'
define table mlan {
  key mandt : abap.clnt not null;
  key matnr : abap.char(40) not null;
  key aland : abap.char(3) not null;
  taxm1     : abap.char(1);
}
