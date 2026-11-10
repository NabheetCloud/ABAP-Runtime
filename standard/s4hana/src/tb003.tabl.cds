@EndUserText.label : 'Business partner roles (customizing)'
define table tb003 {
  key mandt : abap.clnt not null;
  key role  : abap.char(6) not null;
}
