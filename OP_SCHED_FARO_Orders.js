/*
 *Author: Jacob Goodall
 *Date: 01/17/2022
 *Description: Send Orders to FARO
 */

function sendSO() {

	//define header object for nlapiRequestURL() call
	var header = {
    'Cache-Control' : 'no-cache',
		'Content-Type' : 'application/json',
		'Authorization':'ZeRuuM3HfZHJHwkG0JomklVHVbnhN7EB'
	};

  //se: FARO Orders for Integration
  //Update to Production search
	var results = nlapiSearchRecord('salesorder','customsearch5105');

	if(results) {

    var checkGovernance = function() {

			var governanceThreshold = 500;
			var context = nlapiGetContext();

			if(context.getRemainingUsage() < governanceThreshold) {

				try{
					
					var script = nlapiScheduleScript('customscript_op_sched_ddk100auorders');

          if(script == 'QUEUED') {
            nlapiLogExecution('ERROR','Re-scheduling due to governance', 'Successful re-schedule.');
            return true;
          }
          else {
            nlapiLogExecution('ERROR','Problem re-scheduling.', e.code+' : '+e.message);
            return true;
          }
					
				}
				catch(e) {
					nlapiLogExecution('ERROR','Problem re-scheduling.', e.code+' : '+e.message);
					return true;
				}
			}
			else {
				return false;
			}

		};

    //check if ALL of the items are backordered
    var allBackordered = function(rec) {
      for(var i=1; i<=rec.getLineItemCount('item'); i++) {
        if(rec.getLineItemValue('item','quantitycommitted',i) > 0) {
          return false;
        }
      }
      return true;
    };

    var dateConversion = function(date) {
      //convert date to YYYY-MM-DDT00:00:00
      var dateObject = nlapiStringToDate(date);
      var dateMonth = null;
      var dateDay = null;
      if((dateObject.getMonth()+1).toString().length < 2) {
        dateMonth = '0'+(dateObject.getMonth()+1).toString();
      }
      else {
        dateMonth = (dateObject.getMonth()+1).toString();
      }
      if((dateObject.getDate()).toString().length < 2) {
        dateDay = '0'+(dateObject.getDate()).toString();
      }
      else {
        dateDay = (dateObject.getDate()).toString();
      }
      return dateObject.getFullYear()+'-'+dateMonth+'-'+dateDay+'T00:00:00';
    };

    for(var i = 0; i<results.length; i++) {

      try {

        var rec = null;
        var docNumber = null;

        // remove propertie quotes
        var payload = { 
            custbody_webstoreordernumber: "",
            shipaddressee: "", 
            shipattention: "",
            shipaddr1: "",
            shipaddr2: "",
            shipcity: "", 
            shipstate: "",
            shipzip: "",
            shipphone: "",
            shipcountry: "",
            receivebydate: "",
            email: "",
            specialinstructions: "",
            lines: [] 
        }

        //storing backorders in an array 
        var backorderedLines = {lines:[]};
        var backordersPresent = false;
        
        rec = nlapiLoadRecord('salesorder',results[i].getId());
        
        if(allBackordered(rec)) {
          docNumber = rec.getFieldValue('tranid')+'-BO';
        }
        else {
          docNumber = rec.getFieldValue('tranid');
        }
        
        //Puesdo Code
        //Maybe check here to see if that “sent to 3rd party" box is checked.
        // if(rec.getFieldValue('custbody_send_3rd_party') == 'T'){
        //   //change the SO to have the BO at the end so it isn't a duplicate SO
        //   docNumber = rec.getFieldValue('tranid')+'-BO';
        // }

        payload.custbody_webstoreordernumber = rec.getFieldValue("tranid");
        payload.shipaddressee =  rec.getFieldValue("custbody_customer_name");
        payload.shipattention = rec.getFieldValue('shipattention');
        payload.shipaddr1 = rec.getFieldValue('shipaddr1')
        payload.shipaddr2 = rec.getFieldValue('shipaddr2')
        payload.shipcity = rec.getFieldValue('shipcity');
        payload.shipstate = rec.getFieldValue('shipstate');
        payload.shipzip = rec.getFieldValue('shipzip');
        payload.shipphone = rec.getFieldValue('custbody_shiptophone');
        payload.shipcountry = rec.getFieldValue('shipcountry');
        payload.receivebydate = rec.getFieldValue('trandate'); //This is the order date, don't see the recieve by date field.
        payload.email = rec.getFieldValue('custbody_customer_email');
        payload.specialinstructions = rec.getFieldValue('memo');
        

        for(var x=1; x<=rec.getLineItemCount('item'); x++) {
          //Checking location 25/beligum is true
          if(rec.getLineItemValue('item', 'location', x) == 25){
            var item = rec.getLineItemText('item','item',x);
            //check if in stock
            if(rec.getLineItemValue('item','quantitybackordered',x) < 1) {
                //Puesdo code of setting the 3rd party sent checkbox to true probably not the right place. as we are in the line items 
                //rec.setFieldValue('custbody_send_3rd_party', 'T');

                //check if matrix item, strip out parent item if so
                if(item.indexOf(':') !== -1) {
                  item = item.substring(item.indexOf(':')+2);
                }
                payload.lines.push(
                  {
                    line: x,
                    item: item,
                    quantity: Number(rec.getLineItemValue('item','quantitycommitted',x)),
                    description: rec.getLineItemValue('item','discription',x),
                    stock: true
                  }
                );
            }
            else {
              backordersPresent = true;
              
              //check if matrix item, strip out parent item if so
              if(item.indexOf(':') !== -1) {
                item = item.substring(item.indexOf(':')+2);
              }
              //pushing backorders into our backorders array
              backorderedLines.lines.push(
                {
                  line: x,
                  item: item,
                  quantity: Number(rec.getLineItemValue('item','quantitybackordered',x)),
                  description: rec.getLineItemValue('item','description',x),
                  stock: false
                }
              );
            }
          }
        }

        if(payload.lines.length > 0) {

          //json callback function to make null fields to an empty string
          rec.setFieldValue('custbody_ariba_cxml_message',JSON.stringify(payload, function (key, value) { return (value === null) ? "" : value;}));
          nlapiLogExecution('AUDIT','Outbound Payload',JSON.stringify(payload, function (key, value) { return (value === null) ? "" : value;}));

          // var response = nlapiRequestURL(
          //   'https://overture.crea2print.com/json/order/',
          //   JSON.stringify(payload),
          //   header,
          //   null,
          //   'POST'
          // );
  
          var resCode = response.getCode();
          var resBody = response.getBody();
          var resString = resCode+'\n'+JSON.stringify(resBody);
  
          nlapiLogExecution('AUDIT','WMS Response',resString);
  
          if(resCode === 200) {


            if(!backordersPresent){
              //This removes it from saved search if everything is in stock so much have no backoderes lines
              rec.setFieldValue('custbody_outbound_processing_complete','T');
            }
  
            //if there are backordered lines
            //save them in custom field
            if(backorderedLines.lines.length > 0) {
              rec.setFieldValue('custbody_backordered_lines_pending','T');
              rec.setFieldValue('custbody_backordered_lines_data', JSON.stringify(backorderedLines,  function (key, value) { return (value === null) ? "" : value;}));
              rec.setFieldValue('custbody_backorder_doc_number', rec.getFieldValue('tranid')+'-BO');
            }
  
            nlapiSubmitRecord(rec);
            nlapiLogExecution('AUDIT','SUCCESS',rec.getFieldValue('tranid')+' created successfully in WMS');

          }
  
          //else if errors are present, log them and email jacobg@overturepromo.com or kevind@overturepromo.com
          else {
  
            nlapiLogExecution('ERROR','WMS Error',response.toString());
  
            nlapiSendEmail(
              '6',
              'jacobg@overturepromo.com',
              'WMS Faro Error '+docNumber,
              docNumber+'\r\n'+resString,
              null,
              null,
              null,
              null
            );
            
            //still need to submit record to store outbound payload
            nlapiSubmitRecord(rec);
  
          }
        }
        //if no payload.items, all items are backordered
        else {
          rec.setFieldValue('custbody_backordered_lines_pending','T');
          rec.setFieldValue('custbody_backordered_lines_data', JSON.stringify(backorderedLines));
          rec.setFieldValue('custbody_backorder_doc_number', rec.getFieldValue('tranid')+'-BO');

          nlapiSubmitRecord(rec);
          nlapiLogExecution('AUDIT','All backorder order NOT sent.',rec.getFieldValue('tranid'));

        }

        if(i % 10 == 0) {
          if(checkGovernance() == true) {
            break;
          }	
        }
      }

      catch(e) {
        var error = e.code+' :: '+e.message;
        nlapiLogExecution('ERROR','Try / Catch Error',error);
        nlapiSendEmail(
          '6',
          'jacobg@overturepromo.com',
          'Faro Error Main Try/Catch Error',
          error.toString(),
          null,
          null,
          null,
          null
        );
      }
    }
	}
}

